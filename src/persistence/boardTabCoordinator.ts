import { BOARD_LEASE_STORE_NAME, BOARD_STORE_NAME, EDITOR_JOURNAL_STORE_NAME, openCanvasDatabase } from "./database";

export const BOARD_TAB_READ_ONLY_MESSAGE = "Another tab is finishing its edit. Continue editing here when it is ready.";
export const BOARD_TAB_UNVERIFIED_MESSAGE = "Editing access could not be verified. Reopen this board to load the latest device draft.";
export const BOARD_LEASE_DURATION_MS = 20_000;
export const BOARD_LEASE_HEARTBEAT_MS = 5_000;
export type BoardWriteLease = { id: string; ownerId: string; token: string; expiresAt: number; webLock: boolean };
type LeaseHandle = { lease: BoardWriteLease; releaseLock?: () => void };
export type BoardTabOwnership = "acquiring" | "owned" | "unverified" | "contended" | "unavailable" | "passive";
export type BoardTabSignal = { type: "claimed" | "released" | "snapshot" | "handoff"; id: string; source: string; nonce: string };
const SIGNAL_STORAGE_KEY = "scribble:board-tab-signal-v1";
type OwnershipChange = { id: string; owned: boolean; lost: boolean; state: BoardTabOwnership; retained: boolean; error?: unknown };

export class BoardTabReadOnlyError extends Error {
  constructor(state: BoardTabOwnership = "contended") { super(state === "contended" ? BOARD_TAB_READ_ONLY_MESSAGE : BOARD_TAB_UNVERIFIED_MESSAGE); this.name = "BoardTabReadOnlyError"; }
}

/** The lease check and board writes share one IndexedDB transaction. A sleeping
 * tab cannot overwrite the new writer even if its timers or Web Lock are stale. */
export class BoardTabCoordinator {
  readonly tabId: string;
  enabled = false;
  private held = new Map<string, LeaseHandle>();
  private states = new Map<string, BoardTabOwnership>();
  private pending = new Map<string, Promise<BoardWriteLease | null>>();
  private listeners = new Set<(change: OwnershipChange) => void>();
  private signalListeners = new Set<(signal: BoardTabSignal) => void>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private channel: BroadcastChannel | null = null;
  private generation = 0;
  private locks: LockManager | null;
  constructor(private database = openCanvasDatabase, private now = Date.now, tabId: string = crypto.randomUUID(), locks?: LockManager | null) {
    this.tabId = tabId;
    this.locks = locks === undefined ? (typeof navigator !== "undefined" ? navigator.locks ?? null : null) : locks;
  }
  subscribe(listener: (change: OwnershipChange) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  subscribeSignals(listener: (signal: BoardTabSignal) => void) { this.signalListeners.add(listener); return () => { this.signalListeners.delete(listener); }; }
  private receive = (value: unknown) => {
    const signal = value as Partial<BoardTabSignal> | null;
    if (!signal || !["claimed", "released", "snapshot", "handoff"].includes(String(signal.type)) || typeof signal.id !== "string" || signal.source === this.tabId) return;
    if (signal.type === "claimed" && this.held.has(signal.id)) void this.renew(signal.id);
    for (const listener of this.signalListeners) listener(signal as BoardTabSignal);
  };
  private storageSignal = (event: StorageEvent) => {
    if (event.key !== SIGNAL_STORAGE_KEY || !event.newValue) return;
    try { this.receive(JSON.parse(event.newValue)); } catch { /* Malformed signals never grant ownership. */ }
  };
  status(id: string): BoardTabOwnership { return this.states.get(id) ?? "unverified"; }
  hasLease(id: string) { return this.held.has(id); }
  owns(id: string) { return this.held.has(id) && this.status(id) === "owned"; }
  private emit(id: string, state: BoardTabOwnership, lost = false, error?: unknown, retained = false) {
    if (this.status(id) === state && !lost && !error) return;
    this.states.set(id, state);
    for (const listener of this.listeners) listener({ id, owned: state === "owned", lost, state, retained, error });
  }
  start() {
    this.enabled = true;
    if (this.heartbeat === null) this.heartbeat = setInterval(() => { void this.renewAll(); }, BOARD_LEASE_HEARTBEAT_MS);
    if (!this.channel && typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("scribble-board-tabs-v1");
      this.channel.onmessage = (event: MessageEvent<unknown>) => this.receive(event.data);
    }
    if (typeof window !== "undefined") window.addEventListener("storage", this.storageSignal);
  }
  signal(type: BoardTabSignal["type"], id: string) {
    const message: BoardTabSignal = { type, id, source: this.tabId, nonce: crypto.randomUUID() };
    this.channel?.postMessage(message);
    // Also send through storage so mixed BroadcastChannel support interoperates.
    if (typeof localStorage !== "undefined") {
      try { localStorage.setItem(SIGNAL_STORAGE_KEY, JSON.stringify(message)); } catch { /* Polling/atomic leases remain safe without either transport. */ }
    }
  }
  private notify(type: "claimed" | "released", id: string) { this.signal(type, id); }
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
    this.emit(id, "acquiring");
    const generation = this.generation;
    let request: Promise<BoardWriteLease | null>;
    if (this.locks) {
      request = new Promise((resolve, reject) => {
        void this.locks!.request(`scribble:local-board:${id}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
          if (!lock) { this.emit(id, "contended"); resolve(null); return; }
          let releaseLock!: () => void;
          const released = new Promise<void>((done) => { releaseLock = done; });
          try {
            const lease = await this.claim(id, true);
            if (!lease) { this.emit(id, "contended"); resolve(null); return; }
            this.held.set(id, { lease, releaseLock });
            if (generation !== this.generation) { await this.release(id); resolve(null); return; }
            this.emit(id, "owned"); this.notify("claimed", id); resolve(lease);
            await released;
          } catch (error) { reject(error); }
        }).catch(reject);
      });
    } else request = this.claim(id, false).then(async (lease) => {
      if (lease) {
        this.held.set(id, { lease });
        if (generation !== this.generation) { await this.release(id); return null; }
        this.emit(id, "owned"); this.notify("claimed", id);
      } else this.emit(id, "contended");
      return lease;
    });
    const tracked = request.catch((error) => { this.emit(id, "unavailable", false, error); throw error; })
      .finally(() => { if (this.pending.get(id) === tracked) this.pending.delete(id); });
    this.pending.set(id, tracked);
    return tracked;
  }
  private lost(id: string, state: "contended" | "unverified") {
    const held = this.held.get(id);
    if (!held) return;
    this.held.delete(id); held.releaseLock?.(); this.emit(id, state, true);
  }
  async renew(id: string): Promise<boolean> {
    const held = this.held.get(id);
    if (!held) return false;
    let renewed = false;
    let state: "contended" | "unverified" = "unverified";
    try {
      const database = await this.database();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(BOARD_LEASE_STORE_NAME, "readwrite");
        const store = transaction.objectStore(BOARD_LEASE_STORE_NAME), request = store.get(id);
        request.onsuccess = () => {
          const current = request.result as BoardWriteLease | undefined;
          if (this.held.get(id) !== held) return;
          if (!current || current.ownerId !== this.tabId || current.token !== held.lease.token) {
            state = current && current.expiresAt > this.now() ? "contended" : "unverified"; return;
          }
          // Expiry alone proves no takeover. The same durable token can renew
          // atomically, including while this callback still holds the Web Lock.
          const lease = { ...current, expiresAt: this.now() + BOARD_LEASE_DURATION_MS };
          store.put(lease); held.lease = lease; renewed = true;
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
    } catch (error) {
      // Keep the token and actual Web Lock through a storage outage. Rechecking
      // that token later can resume this session without replacing its history.
      if (this.held.get(id) === held) this.emit(id, "unavailable", false, error);
      return false;
    }
    if (this.held.get(id) !== held) return false;
    if (!renewed) this.lost(id, state);
    else this.emit(id, "owned", false, undefined, true);
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
    } finally { held.releaseLock?.(); this.emit(id, "unverified"); this.notify("released", id); }
  }
  async releaseOthers(id: string) { await Promise.all([...this.held.keys()].filter((key) => key !== id && !key.includes(":recovery:")).map((key) => this.release(key))); }
  async close() {
    this.enabled = false;
    this.generation++;
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    await Promise.all([...this.held.keys()].map((id) => this.release(id)));
    this.channel?.close(); this.channel = null;
    if (typeof window !== "undefined") window.removeEventListener("storage", this.storageSignal);
  }
  async write<T extends { id: string }>(id: string, records: T[]): Promise<void> {
    return this.writeRecords(id, records, BOARD_STORE_NAME);
  }
  async writeJournal<T extends { id: string }>(id: string, records: T[]): Promise<void> {
    return this.writeRecords(id, records, EDITOR_JOURNAL_STORE_NAME);
  }
  private async writeRecords<T extends { id: string }>(id: string, records: T[], storeName: string): Promise<void> {
    const held = this.held.get(id);
    if (!held || records.some((record) => record.id !== id && record.id !== `${id}:recovery`)) throw new BoardTabReadOnlyError(this.status(id));
    let denied = false;
    let state: "contended" | "unverified" = "unverified";
    try {
      const database = await this.database();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction([BOARD_LEASE_STORE_NAME, storeName], "readwrite");
        const leases = transaction.objectStore(BOARD_LEASE_STORE_NAME), request = leases.get(id);
        request.onsuccess = () => {
          const current = request.result as BoardWriteLease | undefined;
          if (this.held.get(id) !== held || !current || current.ownerId !== this.tabId || current.token !== held.lease.token) {
            state = current && current.expiresAt > this.now() ? "contended" : "unverified";
            denied = true; transaction.abort(); return;
          }
          // Validate and extend the unchanged token in the board-write transaction;
          // a fallback takeover that committed first always changes this token.
          const lease = { ...current, expiresAt: this.now() + BOARD_LEASE_DURATION_MS };
          leases.put(lease); held.lease = lease;
          for (const record of records) transaction.objectStore(storeName).put(record);
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(denied ? new BoardTabReadOnlyError(state) : transaction.error ?? new Error("Local save was interrupted"));
      });
      if (this.held.get(id) === held) this.emit(id, "owned", false, undefined, true);
      if (storeName === BOARD_STORE_NAME && id === "current-board") this.signal("snapshot", id);
    } catch (error) {
      if (this.held.get(id) === held) {
        if (denied) this.lost(id, state);
        else this.emit(id, "unavailable", false, error);
      }
      throw error;
    }
  }
}

export const boardTabCoordinator = new BoardTabCoordinator();
if (import.meta.hot) import.meta.hot.dispose(() => { void boardTabCoordinator.close(); });
