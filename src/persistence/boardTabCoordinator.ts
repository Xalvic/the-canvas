import { BOARD_LEASE_STORE_NAME, BOARD_STORE_NAME, openCanvasDatabase } from "./database";

export const BOARD_TAB_READ_ONLY_MESSAGE = "This board is open in another tab. Close it there, then reopen here.";
export const BOARD_LEASE_DURATION_MS = 20_000;
export const BOARD_LEASE_HEARTBEAT_MS = 5_000;
export type BoardWriteLease = { id: string; ownerId: string; token: string; expiresAt: number; webLock: boolean };
type LeaseHandle = { lease: BoardWriteLease; releaseLock?: () => void };
type OwnershipChange = { id: string; owned: boolean; lost: boolean };

export class BoardTabReadOnlyError extends Error {
  constructor() { super(BOARD_TAB_READ_ONLY_MESSAGE); this.name = "BoardTabReadOnlyError"; }
}

/** The lease check and board writes share one IndexedDB transaction. A sleeping
 * tab cannot overwrite the new writer even if its timers or Web Lock are stale. */
export class BoardTabCoordinator {
  readonly tabId: string;
  enabled = false;
  private held = new Map<string, LeaseHandle>();
  private pending = new Map<string, Promise<BoardWriteLease | null>>();
  private listeners = new Set<(change: OwnershipChange) => void>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private channel: BroadcastChannel | null = null;
  private generation = 0;
  private locks: LockManager | null;
  constructor(private database = openCanvasDatabase, private now = Date.now, tabId: string = crypto.randomUUID(), locks?: LockManager | null) {
    this.tabId = tabId;
    this.locks = locks === undefined ? (typeof navigator !== "undefined" ? navigator.locks ?? null : null) : locks;
  }
  subscribe(listener: (change: OwnershipChange) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  owns(id: string) { return this.held.has(id); }
  private emit(id: string, owned: boolean, lost = false) { for (const listener of this.listeners) listener({ id, owned, lost }); }
  start() {
    this.enabled = true;
    if (this.heartbeat === null) this.heartbeat = setInterval(() => { void this.renewAll(); }, BOARD_LEASE_HEARTBEAT_MS);
    if (!this.channel && typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("scribble-board-tabs-v1");
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data as { type?: unknown; id?: unknown } | null;
        if (data && data.type === "claimed" && typeof data.id === "string" && this.held.has(data.id)) void this.renew(data.id);
      };
    }
  }
  private notify(type: "claimed" | "released", id: string) { this.channel?.postMessage({ type, id }); }
  private async claim(id: string, webLock: boolean): Promise<BoardWriteLease | null> {
    const database = await this.database();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(BOARD_LEASE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(BOARD_LEASE_STORE_NAME);
      let result: BoardWriteLease | null = null;
      const request = store.get(id);
      request.onsuccess = () => {
        const previous = request.result as BoardWriteLease | undefined;
        // Acquiring the actual Web Lock proves a previous Web Lock owner exited.
        // A fallback lease still needs release/expiry, even when Web Locks exist.
        if (previous && previous.ownerId !== this.tabId && previous.expiresAt > this.now() && !(webLock && previous.webLock)) return;
        result = { id, ownerId: this.tabId, token: crypto.randomUUID(), expiresAt: this.now() + BOARD_LEASE_DURATION_MS, webLock };
        store.put(result);
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("Could not coordinate this local board"));
    });
  }
  acquire(id: string): Promise<BoardWriteLease | null> {
    const held = this.held.get(id);
    if (held) return this.renew(id).then((valid) => valid ? this.held.get(id)?.lease ?? null : null);
    const pending = this.pending.get(id);
    if (pending) return pending;
    const generation = this.generation;
    let request: Promise<BoardWriteLease | null>;
    if (this.locks) {
      request = new Promise((resolve, reject) => {
        void this.locks!.request(`scribble:local-board:${id}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
          if (!lock) { resolve(null); return; }
          let releaseLock!: () => void;
          const released = new Promise<void>((done) => { releaseLock = done; });
          try {
            const lease = await this.claim(id, true);
            if (!lease) { resolve(null); return; }
            this.held.set(id, { lease, releaseLock });
            if (generation !== this.generation) { await this.release(id); resolve(null); return; }
            this.emit(id, true); this.notify("claimed", id); resolve(lease);
            await released;
          } catch (error) { reject(error); }
        }).catch(reject);
      });
    } else request = this.claim(id, false).then(async (lease) => {
      if (lease) {
        this.held.set(id, { lease });
        if (generation !== this.generation) { await this.release(id); return null; }
        this.emit(id, true); this.notify("claimed", id);
      }
      return lease;
    });
    const tracked = request.finally(() => { if (this.pending.get(id) === tracked) this.pending.delete(id); });
    this.pending.set(id, tracked);
    return tracked;
  }
  private lost(id: string) {
    const held = this.held.get(id);
    if (!held) return;
    this.held.delete(id); held.releaseLock?.(); this.emit(id, false, true);
  }
  async renew(id: string): Promise<boolean> {
    const held = this.held.get(id);
    if (!held) return false;
    const database = await this.database();
    let renewed = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(BOARD_LEASE_STORE_NAME, "readwrite");
        const store = transaction.objectStore(BOARD_LEASE_STORE_NAME), request = store.get(id);
        request.onsuccess = () => {
          const current = request.result as BoardWriteLease | undefined;
          if (!current || current.ownerId !== this.tabId || current.token !== held.lease.token || current.expiresAt <= this.now()) return;
          const lease = { ...current, expiresAt: this.now() + BOARD_LEASE_DURATION_MS };
          store.put(lease); held.lease = lease; renewed = true;
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
    } catch { renewed = false; }
    if (!renewed) this.lost(id);
    return renewed;
  }
  async renewAll() { await Promise.all([...this.held.keys()].map((id) => this.renew(id))); }
  async release(id: string) {
    const held = this.held.get(id);
    if (!held) return;
    this.held.delete(id);
    try {
      const database = await this.database();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(BOARD_LEASE_STORE_NAME, "readwrite");
        const store = transaction.objectStore(BOARD_LEASE_STORE_NAME), request = store.get(id);
        request.onsuccess = () => {
          const current = request.result as BoardWriteLease | undefined;
          if (current?.ownerId === this.tabId && current.token === held.lease.token) store.delete(id);
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
    } finally { held.releaseLock?.(); this.emit(id, false); this.notify("released", id); }
  }
  async releaseOthers(id: string) { await Promise.all([...this.held.keys()].filter((key) => key !== id && !key.includes(":recovery:")).map((key) => this.release(key))); }
  async close() {
    this.enabled = false;
    this.generation++;
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    await Promise.all([...this.held.keys()].map((id) => this.release(id)));
    this.channel?.close(); this.channel = null;
  }
  async write<T extends { id: string }>(id: string, records: T[]): Promise<void> {
    const held = this.held.get(id);
    if (!held || records.some((record) => record.id !== id && record.id !== `${id}:recovery`)) throw new BoardTabReadOnlyError();
    const database = await this.database();
    let denied = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction([BOARD_LEASE_STORE_NAME, BOARD_STORE_NAME], "readwrite");
        const leases = transaction.objectStore(BOARD_LEASE_STORE_NAME), request = leases.get(id);
        request.onsuccess = () => {
          const current = request.result as BoardWriteLease | undefined;
          if (!current || current.ownerId !== this.tabId || current.token !== held.lease.token || current.expiresAt <= this.now()) {
            denied = true; transaction.abort(); return;
          }
          const lease = { ...current, expiresAt: this.now() + BOARD_LEASE_DURATION_MS };
          leases.put(lease); held.lease = lease;
          for (const record of records) transaction.objectStore(BOARD_STORE_NAME).put(record);
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(denied ? new BoardTabReadOnlyError() : transaction.error ?? new Error("Local save was interrupted"));
      });
    } catch (error) { if (denied) this.lost(id); throw error; }
  }
}

export const boardTabCoordinator = new BoardTabCoordinator();
if (import.meta.hot) import.meta.hot.dispose(() => { void boardTabCoordinator.close(); });
