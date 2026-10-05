import { afterEach, describe, expect, it, vi } from "vitest";
import { getBoardAsset, type SignedBoardAsset } from "../api/assets";
import { clearCloudImageAccess, getCloudImageAccess, getCloudImageIdentity, resolveCloudImageReference, subscribeCloudImageIdentity } from "./cloudImageAccess";

vi.mock("../api/assets", () => ({ getBoardAsset: vi.fn() }));
const boardId = "550e8400-e29b-41d4-a716-446655440000";
const assetId = "550e8400-e29b-41d4-a716-446655440001";
const signed = (): SignedBoardAsset => ({ boardId, id: assetId, mimeType: "image/png", byteSize: 3,
  width: 2, height: 2, createdAt: 1, url: "https://example.test/signed.png", expiresAt: Date.now() + 300_000 });
afterEach(() => { clearCloudImageAccess(); vi.resetAllMocks(); vi.useRealTimers(); });

describe("ephemeral signed image access", () => {
  it("renders a completed copy from its active-board mapping while preserving source provenance", () => {
    const object = { assetId: "local-id", cloudAsset: { boardId, assetId } };
    const targetBoard = "550e8400-e29b-41d4-a716-446655440002";
    const targetAsset = "550e8400-e29b-41d4-a716-446655440003";
    expect(resolveCloudImageReference(object, { boardId: targetBoard, imageAssets: { "local-id": targetAsset } }))
      .toEqual({ boardId: targetBoard, assetId: targetAsset });
    expect(object.cloudAsset).toEqual({ boardId, assetId });
    expect(resolveCloudImageReference(object, { boardId: targetBoard })).toEqual(object.cloudAsset);
  });
  it("keeps local image display local after upload and ignores inherited mapping fields", () => {
    const account = { boardId, imageAssets: { "local-id": assetId } };
    expect(resolveCloudImageReference({ assetId: "local-id" }, account)).toBeUndefined();
    const object = { assetId: "local-id", cloudAsset: { boardId, assetId } };
    const inherited = Object.create({ "local-id": "inherited-asset" }) as Record<string, string>;
    expect(resolveCloudImageReference(object, { boardId: "other-board", imageAssets: inherited })).toEqual(object.cloudAsset);
  });
  it("deduplicates active and fresh reads by account, board and asset", async () => {
    clearCloudImageAccess("user-a");
    const asset = signed();
    vi.mocked(getBoardAsset).mockResolvedValue(asset);
    const first = getCloudImageAccess("user-a", boardId, assetId);
    const second = getCloudImageAccess("user-a", boardId, assetId);
    expect(first).toBe(second);
    expect(await first).toEqual(asset);
    expect(await getCloudImageAccess("user-a", boardId, assetId)).toEqual(asset);
    expect(getBoardAsset).toHaveBeenCalledTimes(1);
  });
  it("refreshes before expiry and bounds parallel forced retry reads", async () => {
    vi.useFakeTimers();
    clearCloudImageAccess("user-a");
    vi.mocked(getBoardAsset).mockImplementation(async () => signed());
    await getCloudImageAccess("user-a", boardId, assetId);
    vi.advanceTimersByTime(270_001);
    await getCloudImageAccess("user-a", boardId, assetId);
    const one = getCloudImageAccess("user-a", boardId, assetId, true);
    const two = getCloudImageAccess("user-a", boardId, assetId, true);
    expect(one).toBe(two);
    await one;
    expect(getBoardAsset).toHaveBeenCalledTimes(3);
  });
  it("aborts and discards old-account results even if fetch ignores cancellation", async () => {
    clearCloudImageAccess("user-a");
    let finish!: (asset: SignedBoardAsset) => void;
    vi.mocked(getBoardAsset).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = getCloudImageAccess("user-a", boardId, assetId);
    const signal = vi.mocked(getBoardAsset).mock.calls[0][2];
    clearCloudImageAccess("user-b");
    expect(signal?.aborted).toBe(true);
    finish(signed());
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    vi.mocked(getBoardAsset).mockResolvedValue(signed());
    await getCloudImageAccess("user-b", boardId, assetId);
    expect(getBoardAsset).toHaveBeenCalledTimes(2);
    await expect(getCloudImageAccess("user-a", boardId, assetId)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("does not offer stale signed URLs after access revalidation fails", async () => {
    clearCloudImageAccess("user-a");
    vi.mocked(getBoardAsset).mockResolvedValueOnce(signed()).mockRejectedValueOnce(new Error("Access revoked")).mockResolvedValueOnce(signed());
    await getCloudImageAccess("user-a", boardId, assetId);
    await expect(getCloudImageAccess("user-a", boardId, assetId, true)).rejects.toThrow("Access revoked");
    await getCloudImageAccess("user-a", boardId, assetId);
    expect(getBoardAsset).toHaveBeenCalledTimes(3);
  });
  it("notifies mounted renderers immediately on logout and changes epoch on same-user resets", () => {
    clearCloudImageAccess("user-a");
    const epoch = getCloudImageIdentity().epoch;
    const notify = vi.fn();
    const unsubscribe = subscribeCloudImageIdentity(notify);
    clearCloudImageAccess("user-a");
    expect(getCloudImageIdentity().epoch).toBe(epoch + 1);
    clearCloudImageAccess();
    expect(getCloudImageIdentity().userId).toBeNull();
    expect(notify).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
