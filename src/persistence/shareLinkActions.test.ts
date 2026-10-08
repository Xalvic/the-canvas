import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { BoardApiError, BoardSignInRequired } from "../api/boards";
import { copyShareLink, getShareLink, updateShareLink } from "../api/shareLinks";
import { ShareLinkActions } from "./shareLinkActions";

vi.mock("../api/shareLinks", () => ({ getShareLink: vi.fn(), copyShareLink: vi.fn(), updateShareLink: vi.fn(), shareLinkUrl: () => "http://localhost/scribble/#share=disposable" }));
const account = { status: "signed-in" as const, user: { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", displayName: null }, shareLinksEnabled: true };
const boardId = "22222222-2222-4222-8222-222222222222";
const disabled = { enabled: false, role: "viewer" as const, generation: 0, version: 0 };
const enabled = { ...disabled, enabled: true, generation: 1, version: 1 };
let values: Map<string, string>, current: boolean, prepare: ReturnType<typeof vi.fn>, expire: ReturnType<typeof vi.fn>, clipboard: ReturnType<typeof vi.fn>, actions: ShareLinkActions;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); current = true; values = new Map();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  prepare = vi.fn().mockResolvedValue(undefined); expire = vi.fn(); clipboard = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { onLine: true, clipboard: { writeText: clipboard } });
  vi.mocked(getShareLink).mockResolvedValue(disabled);
  vi.mocked(copyShareLink).mockImplementation(async (_id, intent) => ({ settings: enabled, token: "A".repeat(43), requestId: intent.requestId, replayed: false }));
  vi.mocked(updateShareLink).mockImplementation(async (_id, intent) => ({ settings: { ...enabled, version: 2, ...("role" in intent ? { role: intent.role } : { enabled: false }) }, requestId: intent.requestId, replayed: false }));
  actions = new ShareLinkActions(boardId, account, prepare, () => current, expire);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("owner share orchestration", () => {
  it("reads without activating and copies on one deliberate action after journaling", async () => {
    await actions.load(); expect(copyShareLink).not.toHaveBeenCalled(); expect(updateShareLink).not.toHaveBeenCalled();
    await actions.copy();
    expect(prepare).toHaveBeenCalledOnce(); expect(copyShareLink).toHaveBeenCalledOnce(); expect(clipboard).toHaveBeenCalledOnce();
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(copyShareLink).mock.invocationCallOrder[0]);
    expect(actions.getState().message).toContain("Link copied"); expect(values.size).toBe(0);
  });
  it("coalesces repeated clicks and stores only nonsecret intent before dispatch", async () => {
    const pending = deferred<Awaited<ReturnType<typeof copyShareLink>>>();
    vi.mocked(copyShareLink).mockImplementation(async (_id, intent) => {
      expect(JSON.parse([...values.values()][0])).toEqual({ ...intent, kind: "copy" }); return pending.promise;
    });
    const first = actions.copy(); await vi.waitFor(() => expect(copyShareLink).toHaveBeenCalledOnce());
    await actions.copy(); expect(copyShareLink).toHaveBeenCalledOnce();
    const input = vi.mocked(copyShareLink).mock.calls[0][1];
    pending.resolve({ settings: enabled, token: "A".repeat(43), requestId: input.requestId, replayed: false }); await first;
  });
  it("reuses the exact original request after lost response, reload and newer settings", async () => {
    vi.mocked(copyShareLink).mockRejectedValueOnce(new TypeError("Lost response"));
    await actions.copy(); const original = vi.mocked(copyShareLink).mock.calls[0][1];
    expect(actions.getState().pending?.requestId).toBe(original.requestId);
    actions = new ShareLinkActions(boardId, account, prepare, () => current, expire);
    vi.mocked(getShareLink).mockResolvedValue({ ...enabled, version: 8 });
    await actions.load(); await actions.stop(); expect(updateShareLink).not.toHaveBeenCalled();
    await actions.retry(); expect(vi.mocked(copyShareLink).mock.calls[1][1]).toEqual(original);
    expect(values.size).toBe(0);
  });
  it("retains a role intent through an unknown outcome and retries that role, not a newer choice", async () => {
    vi.mocked(updateShareLink).mockRejectedValueOnce(new BoardApiError(502, "HTTP_ERROR", "Unavailable"));
    await actions.role("editor"); const original = vi.mocked(updateShareLink).mock.calls[0][1];
    await actions.role("viewer"); expect(updateShareLink).toHaveBeenCalledOnce();
    await actions.retry(); expect(vi.mocked(updateShareLink).mock.calls[1][1]).toEqual(original);
  });
  it("requires review after supersession and never silently enables a stopped link", async () => {
    vi.mocked(copyShareLink).mockRejectedValueOnce(new TypeError("Lost response")); await actions.copy();
    vi.mocked(copyShareLink).mockRejectedValueOnce(new BoardApiError(409, "SHARE_LINK_REQUEST_SUPERSEDED", "Changed"));
    vi.mocked(getShareLink).mockResolvedValue({ ...disabled, generation: 1, version: 3 });
    await actions.retry();
    expect(copyShareLink).toHaveBeenCalledTimes(2); expect(values.size).toBe(0); expect(clipboard).not.toHaveBeenCalled();
    expect(actions.getState().settings?.enabled).toBe(false); expect(actions.getState().error).toContain("Review");
  });
  it("treats clipboard failure independently and retries copying with no server mutation", async () => {
    clipboard.mockRejectedValueOnce(new Error("Activation required")); await actions.copy();
    expect(actions.getState().url).toBeTruthy(); expect(actions.getState().message).toBeNull(); expect(values.size).toBe(0);
    await actions.retryCopy(); expect(copyShareLink).toHaveBeenCalledOnce(); expect(clipboard).toHaveBeenCalledTimes(2);
    expect(actions.getState().url).toBeNull(); expect(actions.getState().message).toContain("Link copied");
  });
  it("ignores clipboard and UI completion after switching page/account", async () => {
    const pending = deferred<Awaited<ReturnType<typeof copyShareLink>>>(); vi.mocked(copyShareLink).mockReturnValueOnce(pending.promise);
    const work = actions.copy(); await vi.waitFor(() => expect(copyShareLink).toHaveBeenCalledOnce()); current = false;
    pending.resolve({ settings: enabled, token: "A".repeat(43), requestId: vi.mocked(copyShareLink).mock.calls[0][1].requestId, replayed: false });
    await work; expect(clipboard).not.toHaveBeenCalled(); expect(values.size).toBe(1); expect(actions.getState().message).toBeNull();
  });
  it("preserves current work when commit/journaling fails", async () => {
    prepare.mockRejectedValueOnce(new Error("Device save failed")); await actions.copy();
    expect(copyShareLink).not.toHaveBeenCalled(); expect(values.size).toBe(0); expect(clipboard).not.toHaveBeenCalled();
  });
  it("does not dispatch mutations without recoverable tab storage", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => { throw new Error("Unavailable"); } });
    await actions.copy(); expect(copyShareLink).not.toHaveBeenCalled(); expect(clipboard).not.toHaveBeenCalled();
  });
  it("handles unsupported servers and session expiry without copying", async () => {
    vi.mocked(getShareLink).mockRejectedValueOnce(new BoardApiError(503, "SHARE_LINKS_UNSUPPORTED", "Unsupported")); await actions.copy();
    expect(actions.getState().error).toContain("unavailable on this server"); expect(copyShareLink).not.toHaveBeenCalled();
    vi.mocked(getShareLink).mockRejectedValueOnce(new BoardSignInRequired()); await actions.copy();
    expect(expire).toHaveBeenCalledOnce(); expect(clipboard).not.toHaveBeenCalled();
  });
  it("keeps rate-limited mutations for a deliberate retry", async () => {
    vi.mocked(copyShareLink).mockRejectedValueOnce(new BoardApiError(429, "RATE_LIMITED", "Wait", undefined, 1000)); await actions.copy();
    expect(actions.getState().pending).not.toBeNull(); expect(actions.getState().error).toContain("Wait");
  });
  it("uses the settings version the owner reviewed rather than silently rebasing a new choice", async () => {
    await actions.load(); vi.mocked(getShareLink).mockResolvedValue({ ...enabled, role: "editor", version: 8 });
    await actions.stop();
    expect(vi.mocked(updateShareLink).mock.calls[0][1]).toMatchObject({ expectedVersion: disabled.version, enabled: false });
    expect(getShareLink).toHaveBeenCalledOnce();
  });
  it("automatically reconciles the exact Copy without preparation or clipboard activation", async () => {
    const stop = actions.start();
    vi.mocked(copyShareLink).mockRejectedValueOnce(new TypeError("Lost response"));
    await actions.copy();
    const original = vi.mocked(copyShareLink).mock.calls[0][1];
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(copyShareLink).mock.calls[1][1]).toEqual(original);
    expect(prepare).toHaveBeenCalledOnce(); expect(clipboard).not.toHaveBeenCalled();
    expect(actions.getState()).toMatchObject({ pending: null, recoveredCopy: true });
    expect(actions.getState().url).toBeTruthy(); stop();
  });
  it("bounds automatic attempts and resumes the original intent after becoming visible and online", async () => {
    const stop = actions.start();
    vi.mocked(copyShareLink).mockRejectedValue(new TypeError("Offline transport"));
    await actions.copy();
    const original = vi.mocked(copyShareLink).mock.calls[0][1];
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(copyShareLink).toHaveBeenCalledOnce();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(5000); expect(copyShareLink).toHaveBeenCalledOnce();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(copyShareLink).toHaveBeenCalledTimes(3);
    expect(vi.mocked(copyShareLink).mock.calls.every((call) => JSON.stringify(call[1]) === JSON.stringify(original))).toBe(true);
    expect(prepare).toHaveBeenCalledOnce(); stop();
  });
  it("never automatically replays a rate-limited request or a disposed owner lifetime", async () => {
    const stop = actions.start();
    vi.mocked(copyShareLink).mockRejectedValueOnce(new BoardApiError(429, "RATE_LIMITED", "Wait", undefined, 1000));
    await actions.copy(); await vi.advanceTimersByTimeAsync(10_000); expect(copyShareLink).toHaveBeenCalledOnce();
    stop(); window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(10_000);
    expect(copyShareLink).toHaveBeenCalledOnce(); expect(actions.getState().pending).not.toBeNull();
  });
});
