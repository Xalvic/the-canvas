import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageKitStorage, IMAGE_URL_TTL_SECONDS } from "./imageKit.js";

const config = { privateKey: "private_SENSITIVE_TEST_VALUE", urlEndpoint: "https://ik.imagekit.io/scribblemilan", folder: "scribble/dev" };
const target = { boardId: "67a09954-73f4-4a6f-bf8f-5cac7bb2c4c5", assetId: "e331c9b1-67a9-4209-a676-4b50f8e19ce3", extension: "png", mimeType: "image/png" } as const;
const path = `/scribble/dev/${target.boardId}/${target.assetId}.png`;
const stored = { fileId: "safe_id", filePath: path, size: 3, isPrivateFile: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("ImageKit storage boundary", () => {
  it("uploads an immutable private file with no browser upload credentials", async () => {
    let fields: FormData | undefined;
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).startsWith("data:")) return new Response();
      fields = await new Response(init!.body).formData();
      return json(stored);
    });
    vi.stubGlobal("fetch", fetch);
    const storage = createImageKitStorage(config);
    expect(storage.pathFor(target)).toBe(path);
    expect(await storage.upload(Buffer.from("123"), target)).toEqual({ fileId: "safe_id", filePath: path, size: 3 });
    expect(fields!.get("folder")).toBe(`/scribble/dev/${target.boardId}`);
    expect(fields!.get("fileName")).toBe(`${target.assetId}.png`);
    expect(fields!.get("isPrivateFile")).toBe("true");
    expect(fields!.get("useUniqueFileName")).toBe("false");
    expect(fields!.get("overwriteFile")).toBe("false");
    expect(fields!.get("publicKey")).toBeNull();
    expect(fields!.get("extensions")).toBeNull();
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith("https://upload.imagekit.io/"))).toHaveLength(1);
  });
  it("generates a five-minute HMAC signature over the exact owned path", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    const expiry = Math.floor(Date.now() / 1000) + IMAGE_URL_TTL_SECONDS;
    const url = new URL(createImageKitStorage(config).sign(path, expiry));
    expect(url.origin + url.pathname).toBe(config.urlEndpoint + path);
    expect(url.searchParams.get("ik-t")).toBe(String(expiry));
    expect(url.searchParams.get("ik-s")).toBe(createHmac("sha1", config.privateKey).update(path.slice(1) + expiry).digest("hex"));
    expect(url.href).not.toContain(config.privateKey);
  });
  it("cannot sign arbitrary provider files or long/nonexpiring URLs", () => {
    const storage = createImageKitStorage(config);
    const now = Math.floor(Date.now() / 1000);
    for (const unsafe of ["/existing-user-image.png", path + "?tr=w-9000", "/scribble/dev/../image.png", "https://elsewhere.example/img.png"]) {
      expect(() => storage.sign(unsafe, now + 300)).toThrow(/Image storage/);
    }
    for (const expiry of [now, now - 1, now + 301, Infinity]) expect(() => storage.sign(path, expiry)).toThrow(/Image storage/);
  });
  it.each([
    { ...stored, filePath: "/existing-user-image.png" },
    { ...stored, size: 4 },
    { ...stored, isPrivateFile: false },
    { ...stored, fileId: undefined },
  ])("rejects unsafe provider responses", async (response) => {
    vi.stubGlobal("fetch", vi.fn(async () => json(response)));
    await expect(createImageKitStorage(config).upload(Buffer.from("123"), target)).rejects.toThrow(/Image storage upload failed/);
  });
  it("hides provider errors/secrets and never retries uncertain uploads", async () => {
    const fetch = vi.fn(async (url: unknown) => String(url).startsWith("data:") ? new Response() : json({ message: `secret ${config.privateKey}` }, 503));
    vi.stubGlobal("fetch", fetch);
    await expect(createImageKitStorage(config).upload(Buffer.from("123"), target)).rejects.toThrow("Image storage upload failed");
    try { await createImageKitStorage(config).upload(Buffer.from("123"), target); }
    catch (error) { expect(String(error)).not.toContain(config.privateKey); }
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith("https://upload.imagekit.io/"))).toHaveLength(2);
  });
  it("finds only the exact deterministic path for uncertain-upload cleanup", async () => {
    const fetch = vi.fn(async () => json([stored, { ...stored, filePath: "/unrelated.png" }]));
    vi.stubGlobal("fetch", fetch);
    expect(await createImageKitStorage(config).find(path)).toEqual({ fileId: "safe_id", filePath: path, size: 3 });
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.searchParams.get("path")).toBe(`/scribble/dev/${target.boardId}/`);
    expect(url.searchParams.get("searchQuery")).toBe(`name = "${target.assetId}.png"`);
    expect(url.searchParams.get("limit")).toBe("2");
  });
  it("returns no match safely and treats an already deleted provider file as success", async () => {
    const fetch = vi.fn(async (url: unknown) => String(url).includes("safe_id") ? json({}, 404) : json([]));
    vi.stubGlobal("fetch", fetch);
    const storage = createImageKitStorage(config);
    expect(await storage.find(path)).toBeNull();
    await expect(storage.delete("safe_id")).resolves.toBeUndefined();
    await expect(storage.delete("../existing-user-image")).rejects.toThrow(/Image storage delete failed/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
