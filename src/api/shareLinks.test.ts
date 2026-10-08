import { afterEach, describe, expect, it, vi } from "vitest";
import { copyShareLink, getShareLink, openShareLink, shareLinkUrl, updateShareLink } from "./shareLinks";
import type { AccountState } from "./auth";

const boardId = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222";
const account: AccountState = { status: "signed-in", user: { id: "33333333-3333-4333-8333-333333333333", email: "owner@example.com", displayName: null }, shareLinksEnabled: true };
const token = "disposable".padEnd(43, "a");
const settings = { enabled: true, role: "viewer", generation: 1, version: 1 };
const intent = { requestId, expectedVersion: 0 };
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });
afterEach(() => vi.unstubAllGlobals());

describe("share-link client boundary", () => {
  it("uses account fencing and CSRF on copy and keeps the caller's stable intent", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ settings, token, requestId, replayed: false }));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect((await copyShareLink(boardId, intent, account, signal)).settings.role).toBe("viewer");
    const init = fetch.mock.calls[0][1];
    expect(init.credentials).toBe("same-origin"); expect(init.signal).toBe(signal);
    expect(init.headers).toMatchObject({ "X-Scribble-Request": "1", "X-Scribble-Account": account.user.id });
    expect(JSON.parse(init.body)).toEqual(intent);
  });
  it("checks capability before making any request to an older or incompatible server", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const shareLinksEnabled of [false, undefined]) {
      const older = { ...account, shareLinksEnabled };
      await expect(getShareLink(boardId, older)).rejects.toMatchObject({ code: "SHARE_LINKS_UNSUPPORTED" });
      await expect(copyShareLink(boardId, intent, older)).rejects.toMatchObject({ code: "SHARE_LINKS_UNSUPPORTED" });
      await expect(openShareLink(token, older)).rejects.toMatchObject({ code: "SHARE_LINKS_UNSUPPORTED" });
    }
    await expect(openShareLink(token, { status: "guest", googleSignInEnabled: true })).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains the exact original intent after a lost response without automatic retry", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Network unavailable")).mockResolvedValueOnce(json({ settings, token, requestId, replayed: true }));
    vi.stubGlobal("fetch", fetch);
    await expect(copyShareLink(boardId, intent, account)).rejects.toThrow("Network unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await copyShareLink(boardId, intent, account)).replayed).toBe(true);
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
  });
  it.each([
    [401, "UNAUTHENTICATED"], [404, "SHARE_LINK_UNAVAILABLE"], [403, "BOARD_FORBIDDEN"],
    [409, "SHARE_LINK_VERSION_CONFLICT"], [409, "ACCOUNT_CHANGED"], [429, "REQUEST_RATE_LIMIT"], [503, "SHARE_LINKS_UNSUPPORTED"],
  ])("preserves distinguishable server failure %s %s", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { code, message: "Try again" } }, status, { "Retry-After": "12" })));
    await expect(openShareLink(token, account)).rejects.toMatchObject({ status, code });
  });
  it("rejects false copy success and wrong request identities", async () => {
    for (const change of [{ requestId: boardId }, { token: "bad" }, { settings: { ...settings, enabled: false } }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ settings, token, requestId, replayed: false, ...change })));
      await expect(copyShareLink(boardId, intent, account)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });
  it("reads nonsecret settings and sends strict stop intent without activating a link", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ settings })).mockResolvedValueOnce(json({ settings: { ...settings, enabled: false, version: 2 }, requestId, replayed: false }));
    vi.stubGlobal("fetch", fetch);
    expect(await getShareLink(boardId, account)).toEqual(settings);
    await updateShareLink(boardId, { requestId, expectedVersion: 1, enabled: false }, account);
    expect(fetch.mock.calls[0][1].headers).toEqual({ "X-Scribble-Account": account.user.id });
    expect(fetch.mock.calls[1][1].method).toBe("PATCH");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ requestId, expectedVersion: 1, enabled: false });
  });
  it("keeps tokens in the authenticated POST body and URLs in the application fragment", async () => {
    const board = { id: boardId, title: "Shared", role: "editor" };
    const fetch = vi.fn().mockResolvedValue(json({ board })); vi.stubGlobal("fetch", fetch);
    expect(await openShareLink(token, account)).toEqual(board);
    expect(fetch.mock.calls[0][0]).toBe("/api/share-links/open");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ token });
    const url = new URL(shareLinkUrl(token, "https://example.com", "/scribble/"));
    expect(url.pathname).toBe("/scribble/"); expect(url.search).toBe("");
    expect(url.hash === `#share=${token}`).toBe(true);
    expect(() => shareLinkUrl(token, "https://example.com", "//hostile.example/")).toThrow();
  });
});
