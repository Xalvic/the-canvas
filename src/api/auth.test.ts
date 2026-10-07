import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccount, signOut } from "./auth";

afterEach(() => vi.unstubAllGlobals());
const user = { id: "550e8400-e29b-41d4-a716-446655440000", email: "artist@example.com", displayName: "Artist" };
describe("account API boundary", () => {
  it("validates signed-in user data and forwards abort/same-origin credential settings", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await getAccount(signal)).toEqual({ status: "signed-in", user, guestTransferEnabled: false });
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/auth/me", { credentials: "same-origin", signal });
  });
  it.each([true, false])("handles guest state without treating sign-in availability %s as a login", async (enabled) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", details: { googleSignInEnabled: enabled } } }), { status: 401 })));
    expect(await getAccount(new AbortController().signal)).toEqual({ status: "guest", googleSignInEnabled: enabled });
  });
  it.each([
    [200, { user: { ...user, id: "invalid" } }],
    [401, { error: { code: "UNAUTHENTICATED" } }],
    [500, { error: { code: "INTERNAL_ERROR" } }],
  ])("rejects malformed/error response %s", async (status, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
    await expect(getAccount(new AbortController().signal)).rejects.toThrow();
  });
  it("logs out with the CSRF header and reports failures without manufacturing signed-out state", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await signOut(signal);
    expect(fetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "X-Scribble-Request": "1" }, signal });
    await expect(signOut(signal)).rejects.toThrow("Could not sign out");
  });
});
it("advertises transfer support only for the compatible signed-in server contract", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ user, capabilities: { guestTransfer: 1 } }))));
  expect(await getAccount(new AbortController().signal)).toEqual({ status: "signed-in", user, guestTransferEnabled: true });
});
it("older servers retain identity while leaving transfer support disabled", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ user }))));
  expect(await getAccount(new AbortController().signal)).toEqual({ status: "signed-in", user, guestTransferEnabled: false });
});
it("preserves Google-only guest availability and optional transfer support", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", details: { googleSignInEnabled: true, guestTransferEnabled: true } } }), { status: 401 })));
  expect(await getAccount(new AbortController().signal)).toEqual({ status: "guest", googleSignInEnabled: true, guestTransferEnabled: true });
});
