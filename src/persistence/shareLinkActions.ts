import { z } from "zod";
import type { AccountState } from "../api/auth";
import { BoardApiError, BoardSignInRequired } from "../api/boards";
import { copyShareLink, getShareLink, shareLinkUrl, updateShareLink, type ShareLinkSettings } from "../api/shareLinks";

const identity = { requestId: z.uuid(), expectedVersion: z.number().int().nonnegative() };
const intentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...identity, kind: z.literal("copy") }),
  z.strictObject({ ...identity, kind: z.literal("role"), role: z.enum(["viewer", "editor"]) }),
  z.strictObject({ ...identity, kind: z.literal("stop") }),
]);
type Intent = z.infer<typeof intentSchema>;
export type ShareActionState = {
  busy: boolean; settings: ShareLinkSettings | null; message: string | null;
  error: string | null; url: string | null; pending: Intent | null; recoveredCopy: boolean;
};

// One owner/page lifetime. Persist only nonsecret mutation identity before sending.
// Automatic reconciliation checks the original intent; a newer Stop is never silently rebased.
export class ShareLinkActions {
  private state: ShareActionState = { busy: false, settings: null, message: null, error: null, url: null, pending: null, recoveredCopy: false };
  private listeners = new Set<() => void>();
  private request: AbortController | null = null;
  private active = true;
  private key: string;
  private reconciliationTimer: ReturnType<typeof setTimeout> | null = null;
  private automaticAttempts = 0;
  private reconcileEnabled = true;
  private settingsReadAt = 0;
  private settingsReadFailed = false;
  constructor(private boardId: string, private account: Extract<AccountState, { status: "signed-in" }>,
    private prepare: (signal: AbortSignal) => Promise<void>, private current: () => boolean,
    private expire: () => void, private changed: () => void = () => {}) {
    this.key = `scribble:share-mutation:${account.user.id}:${boardId}`;
  }
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private valid() { return this.active && this.current(); }
  private update(patch: Partial<ShareActionState>) {
    if (!this.valid()) return;
    this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener());
  }
  start = () => {
    this.active = true;
    if (this.request?.signal.aborted) this.request = null;
    this.update({ busy: false });
    try { this.update({ pending: this.stored() }); }
    catch { /* Explicit actions report unavailable tab storage before sending. */ }
    const resume = () => {
      if (!this.valid() || !this.available() || !this.reconcileEnabled || this.state.busy) return;
      this.automaticAttempts = 0;
      this.scheduleReconciliation();
    };
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    this.scheduleReconciliation();
    return () => {
      this.active = false; this.request?.abort(); this.cancelReconciliation();
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  };
  private available() { return document.visibilityState !== "hidden" && navigator.onLine !== false; }
  private cancelReconciliation() {
    if (this.reconciliationTimer !== null) clearTimeout(this.reconciliationTimer);
    this.reconciliationTimer = null;
  }
  private scheduleReconciliation() {
    if (!this.valid() || !this.available() || !this.state.pending || this.state.busy || !this.reconcileEnabled ||
      this.reconciliationTimer !== null || this.automaticAttempts >= 2) return;
    this.reconciliationTimer = setTimeout(() => {
      this.reconciliationTimer = null;
      if (!this.valid() || !this.available() || this.state.busy || !this.state.pending) return;
      this.automaticAttempts += 1;
      void this.mutate(undefined, undefined, true);
    }, this.automaticAttempts === 0 ? 1000 : 3000);
  }
  private stored() {
    const raw = sessionStorage.getItem(this.key);
    return raw ? intentSchema.parse(JSON.parse(raw)) : null;
  }
  private clear() { sessionStorage.removeItem(this.key); this.cancelReconciliation(); this.update({ pending: null }); }
  private failure(error: unknown, uncertain: boolean) {
    if (!this.valid()) return;
    if (error instanceof BoardSignInRequired) { this.expire(); return; }
    const code = error instanceof BoardApiError ? error.code : "";
    const text = code === "SHARE_LINKS_UNSUPPORTED" || code === "SHARE_LINKS_UNAVAILABLE" ? "Link sharing is unavailable on this server. Try again after the server is updated."
      : code === "ACCOUNT_CHANGED" ? "Your account changed. Return to the account that started this request."
      : code === "SHARE_LINK_VERSION_CONFLICT" || code === "SHARE_LINK_REQUEST_SUPERSEDED" ? "Link settings changed elsewhere. Review the current settings before choosing another action."
      : error instanceof BoardApiError && error.status === 429 ? "Too many link requests. Wait a moment, then retry the same request."
      : code === "SHARE_LINK_KEY_UNAVAILABLE" ? "The active link cannot be copied. Ask the server administrator to check link sharing, or stop sharing before creating a new link."
      : uncertain ? "Couldn’t confirm the link request. Your original request is saved for checking."
      : "Couldn’t check link settings. Try again.";
    this.update({ error: text });
  }
  private async run(work: (signal: AbortSignal) => Promise<void>, clearFeedback = true) {
    if (this.state.busy || !this.valid()) return;
    const request = new AbortController(); this.request = request;
    const timeout = setTimeout(() => request.abort(), 20_000);
    this.update({ busy: true, ...(clearFeedback ? { error: null, message: null } : {}) });
    try { await work(request.signal); }
    finally {
      clearTimeout(timeout);
      if (this.request === request) {
        this.request = null; this.update({ busy: false }); this.scheduleReconciliation();
      }
    }
  }
  load = (background = false, force = false) => {
    // Reads cannot settle receipts. Keep failed-request feedback until its exact replay settles.
    if (this.state.pending) { this.scheduleReconciliation(); return Promise.resolve(); }
    if (!force && (background || !this.state.error) && this.state.settings && Date.now() - this.settingsReadAt < 30_000) return Promise.resolve();
    return this.run(async (signal) => {
      try {
        const pending = this.stored(); this.update({ pending });
        if (pending) return;
        const settings = await getShareLink(this.boardId, this.account, signal);
        if (!this.valid() || signal.aborted) return;
        this.settingsReadAt = Date.now();
        this.update({ settings, ...(this.settingsReadFailed ? { error: null } : {}) });
        this.settingsReadFailed = false;
      } catch (error) {
        if (signal.aborted && this.request?.signal !== signal) return;
        this.settingsReadFailed = true; this.failure(error, false);
      }
    }, !background);
  };
  copy = () => this.requested("copy");
  role = (role: "viewer" | "editor") => this.requested("role", role);
  stop = () => this.requested("stop");
  retry = () => this.requested();
  private requested(kind?: Intent["kind"], role?: "viewer" | "editor") {
    if (this.state.busy || !this.valid()) return Promise.resolve();
    this.cancelReconciliation(); this.automaticAttempts = 0; this.reconcileEnabled = true;
    return this.mutate(kind, role);
  }
  private mutate = (kind?: Intent["kind"], role?: "viewer" | "editor", automatic = false) => this.run(async (signal) => {
    let intent: Intent | null = null;
    let prepared = false, dispatched = false;
    try {
      intent = this.stored(); this.update({ pending: intent, url: null, recoveredCopy: false });
      // A background check can only replay a recorded intent, never create one.
      if (automatic && !intent) return;
      if (intent && kind && (intent.kind !== kind || intent.kind === "role" && intent.role !== role)) {
        this.update({ error: "The earlier request must be checked before choosing a different action." }); return;
      }
      // The recorded intent was already prepared. Background recovery must never
      // blur inputs, commit an active stroke, flush a draft or create history entries.
      if (!automatic) await this.prepare(signal);
      prepared = true;
      if (!this.valid() || signal.aborted) return;
      if (!intent) {
        const settings = this.state.settings ?? await getShareLink(this.boardId, this.account, signal);
        if (!this.valid() || signal.aborted) return;
        this.settingsReadAt = Date.now(); this.update({ settings });
        if (!kind) return;
        intent = intentSchema.parse({ requestId: crypto.randomUUID(), expectedVersion: settings.version, kind, ...(kind === "role" ? { role } : {}) });
        sessionStorage.setItem(this.key, JSON.stringify(intent));
        this.update({ pending: intent });
      }
      const { requestId, expectedVersion } = intent;
      signal.throwIfAborted();
      dispatched = true;
      const result = intent.kind === "copy" ? await copyShareLink(this.boardId, { requestId, expectedVersion }, this.account, signal)
        : await updateShareLink(this.boardId, { requestId, expectedVersion, ...(intent.kind === "role" ? { role: intent.role } : { enabled: false as const }) }, this.account, signal);
      if (!this.valid() || signal.aborted) return;
      this.clear(); this.settingsReadAt = Date.now(); this.update({ settings: result.settings }); this.changed();
      if ("token" in result && typeof result.token === "string") {
        const url = shareLinkUrl(result.token);
        // Recovery has no clipboard gesture. Keep its URL in memory without stealing focus.
        if (automatic) this.update({ url, recoveredCopy: true, message: "Your earlier link request is confirmed. Copy the link when you’re ready." });
        else await this.clipboard(url);
      }
      else this.update({ message: intent.kind === "stop" ? "Link sharing stopped. Existing invited members keep their access." : "Link permission updated.", url: null });
    } catch (error) {
      if (!this.valid() || (signal.aborted && this.request?.signal !== signal)) return;
      const conflict = error instanceof BoardApiError && ["SHARE_LINK_VERSION_CONFLICT", "SHARE_LINK_REQUEST_SUPERSEDED"].includes(error.code);
      // Definitive pre-commit failures can start a new deliberate action. Transport,
      // timeout, malformed success and server errors retain the dispatched identity.
      const definitive = error instanceof BoardApiError && (error.code === "SHARE_LINK_KEY_UNAVAILABLE" || error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429);
      this.reconcileEnabled = prepared && dispatched && !definitive && !(error instanceof BoardApiError && error.status === 429);
      if (definitive || conflict) {
        this.clear();
        if (conflict) {
          try {
            const settings = await getShareLink(this.boardId, this.account, signal);
            if (!this.valid() || signal.aborted) return;
            this.settingsReadAt = Date.now(); this.update({ settings }); this.changed();
          } catch { /* Keep the conflict visible; error-only Retry can recover the read. */ }
        }
      }
      if (!prepared) this.update({ error: "Your drawing could not be preserved on this device. Retry before sharing." });
      else if (intent && !dispatched) this.update({ error: "This browser cannot preserve the link request. Enable tab storage, then try again." });
      else this.failure(error, !!intent && !definitive);
    }
  });
  private async clipboard(url: string) {
    if (!this.valid()) return;
    try {
      await navigator.clipboard.writeText(url);
      this.update({ url: null, recoveredCopy: false, message: `Link copied · ${this.state.settings?.role === "editor" ? "Can edit" : "Can view"}` });
    } catch { this.update({ url, recoveredCopy: false, error: "The link is ready, but copying was blocked. Copy it below or select the address manually." }); }
  }
  retryCopy = () => this.run(async () => { if (this.state.url) await this.clipboard(this.state.url); });
  dismissCopy = () => { this.update({ url: null, recoveredCopy: false, error: null, message: null }); };
  dismissMessage = () => { this.update({ message: null }); };
}
