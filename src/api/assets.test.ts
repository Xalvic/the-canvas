import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBoardAsset, getBoardAsset, MAX_CLOUD_IMAGE_BYTES, uploadBoardAsset } from "./assets";

const boardId = "550e8400-e29b-41d4-a716-446655440000";
const assetId = "550e8400-e29b-41d4-a716-446655440001";
const otherId = "550e8400-e29b-41d4-a716-446655440002";
const asset = { boardId, id: assetId, mimeType: "image/png", byteSize: 3, width: 2, height: 2, createdAt: 1 };
const signed = () => ({ ...asset, url: "https://ik.imagekit.io/test/private.png?ik-s=signature", expiresAt: Date.now() + 300_000 });
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
function mockResponse(value: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(response(value, status));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe("cloud asset API", () => {
  it("uploads raw MIME bytes with the existing mutation protection and signal", async () => {
    const fetch = mockResponse({ asset }, 201);
    const blob = new Blob(["png"], { type: "image/png" });
    const controller = new AbortController();
    const signal = controller.signal;
    expect(await uploadBoardAsset(boardId, blob, signal)).toEqual(asset);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/boards/${boardId}/assets`, {
      credentials: "same-origin", method: "POST", headers: { "X-Scribble-Request": "1", "Content-Type": "image/png" }, body: blob, signal: expect.any(AbortSignal),
    });
    const forwarded = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
    expect(forwarded.aborted).toBe(false);
    controller.abort();
    expect(forwarded.aborted).toBe(true);
  });
  it.each([
    new Blob(["gif"], { type: "image/gif" }), new Blob([], { type: "image/png" }),
    new Blob([new Uint8Array(MAX_CLOUD_IMAGE_BYTES + 1)], { type: "image/png" }),
  ])("rejects unsupported/empty/oversized local uploads before contacting the server", async (blob) => {
    const fetch = mockResponse({ asset }, 201);
    await expect(uploadBoardAsset(boardId, blob)).rejects.toThrow("Cloud images");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reads signed image identity with no-store and the authenticated API", async () => {
    const value = signed();
    const fetch = mockResponse({ asset: value });
    const signal = new AbortController().signal;
    expect(await getBoardAsset(boardId, assetId, signal)).toEqual(value);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/boards/${boardId}/assets/${assetId}`, {
      credentials: "same-origin", cache: "no-store", signal,
    });
  });
  it.each([
    { boardId: otherId }, { id: otherId }, { width: 4097 }, { byteSize: MAX_CLOUD_IMAGE_BYTES + 1 },
    { width: 4096, height: 4096 }, { mimeType: "image/svg+xml" }, { expiresAt: 0 },
    { expiresAt: Date.now() + 600_000 }, { url: "http://remote.test/image.png" }, { url: "data:image/png;base64,a" },
    { url: "https://password:secret@remote.test/image.png" },
  ])("rejects malformed or mismatched signed metadata %j", async (changes) => {
    mockResponse({ asset: { ...signed(), ...changes } });
    await expect(getBoardAsset(boardId, assetId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("preserves authentication, permission, quota and unavailable API errors", async () => {
    for (const [status, code] of [[401, "UNAUTHENTICATED"], [403, "FORBIDDEN"], [429, "ASSET_RATE_LIMITED"], [503, "ASSET_STORAGE_UNAVAILABLE"]] as const) {
      mockResponse({ error: { code, message: "Image request failed" } }, status);
      await expect(getBoardAsset(boardId, assetId)).rejects.toMatchObject({ status, code });
    }
  });
  it("checks source access before downloading transient bytes for an explicit copy", async () => {
    const value = signed();
    const fetch = vi.fn().mockResolvedValueOnce(response({ asset: value }))
      .mockResolvedValueOnce(new Response("png", { headers: { "content-type": "image/png", "content-length": "3" } }));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    const blob = await downloadBoardAsset(boardId, assetId, signal);
    expect(blob.type).toBe("image/png");
    expect(await blob.text()).toBe("png");
    expect(fetch).toHaveBeenNthCalledWith(2, value.url, { credentials: "omit", cache: "no-store", redirect: "error", signal });
  });
  it("does not download bytes when source access is denied", async () => {
    const fetch = mockResponse({ error: { code: "BOARD_NOT_FOUND", message: "Board not found" } }, 404);
    await expect(downloadBoardAsset(boardId, assetId)).rejects.toMatchObject({ status: 404 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    new Response("png", { headers: { "content-type": "image/gif" } }),
    new Response("png", { headers: { "content-type": "image/png", "content-length": String(MAX_CLOUD_IMAGE_BYTES + 1) } }),
    new Response("too-long", { headers: { "content-type": "image/png" } }),
    new Response("p", { headers: { "content-type": "image/png" } }),
  ])("rejects unsupported MIME and oversized/incomplete downloaded bodies", async (download) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ asset: signed() })).mockResolvedValueOnce(download));
    await expect(downloadBoardAsset(boardId, assetId)).rejects.toThrow();
  });
  it("aborts before copy access or byte download when already cancelled", async () => {
    const fetch = mockResponse({ asset: signed() });
    const controller = new AbortController(); controller.abort();
    await expect(downloadBoardAsset(boardId, assetId, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("cancels a stalled download stream promptly on abort", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ asset: signed() }))
      .mockResolvedValueOnce(new Response(stream, { headers: { "content-type": "image/png" } })));
    const controller = new AbortController();
    const pending = downloadBoardAsset(boardId, assetId, controller.signal);
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
