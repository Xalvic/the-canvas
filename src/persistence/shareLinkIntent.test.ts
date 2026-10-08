import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { shareLinkIntent, invalidShareLink, rememberShareLinkIntent, clearShareLinkIntent } from "./shareLinkIntent";
const token = "A".repeat(43);
let values: Map<string, string>, browser: { location: { href: string }; history: { state: null; replaceState: ReturnType<typeof vi.fn> } };
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  browser = { location: { href: `https://example.com/scribble/#share=${token}` }, history: { state: null, replaceState: vi.fn((_state, _title, url) => { browser.location.href = String(url); }) } };
  vi.stubGlobal("window", browser);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("keeps validated intent only in this tab across redirect and removes the address-bar secret", () => {
  expect(shareLinkIntent()).toBeTruthy(); rememberShareLinkIntent(); expect(new URL(browser.location.href).hash).toBe("");
  expect(shareLinkIntent()).toBeTruthy(); clearShareLinkIntent(token); expect(shareLinkIntent()).toBeNull(); expect(values.size).toBe(0);
});
it("rejects malformed fragments without falling back to another stored secret", () => {
  rememberShareLinkIntent(); browser.location.href += "#share=invalid";
  expect(invalidShareLink()).toBe(true); expect(shareLinkIntent()).toBeNull();
});
it("expires the tab intent after ten minutes", () => {
  vi.useFakeTimers(); rememberShareLinkIntent(); vi.advanceTimersByTime(10 * 60_000 + 1); expect(shareLinkIntent()).toBeNull(); expect(values.size).toBe(0);
});
it("keeps the original fragment and gives recovery instructions when storage is unavailable", () => {
  vi.stubGlobal("sessionStorage", { setItem: () => { throw new Error("Blocked"); } });
  expect(() => rememberShareLinkIntent()).toThrow("reopen the original link"); expect(new URL(browser.location.href).hash.startsWith("#share=")).toBe(true);
});
it("clearing an older destination preserves a newly opened link", () => {
  rememberShareLinkIntent(); browser.location.href += `#share=${"B".repeat(43)}`;
  clearShareLinkIntent(token); expect(shareLinkIntent()).toBe("B".repeat(43));
});
