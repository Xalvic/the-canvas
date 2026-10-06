import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardSignInRequired } from "./boards";
import { getServerWorkspace, initializeServerWorkspace, updateServerWorkspace } from "./workspace";

afterEach(() => vi.unstubAllGlobals());
const requestId = "ABCDEFAB-1234-4123-8123-ABCDEFABCDEF";
const boardId = "11111111-1111-4111-8111-111111111111";
const workspace = { initialized: true, lastOpenedBoardId: null };
const input = { requestId, createInitialPage: true };
const result = { workspace, board: { id: boardId, title: "Untitled", role: "owner", createdAt: 1, updatedAt: 1 },
  initialization: { requestId: requestId.toLowerCase(), replayed: false, initializedNow: true } };
function respond(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch); return fetch;
}
describe("workspace client contract", () => {
  it("reads state with same-origin credentials and forwards cancellation", async () => {
    const fetch = respond({ workspace }), signal = new AbortController().signal;
    expect(await getServerWorkspace(signal)).toEqual(workspace);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/workspace", { credentials: "same-origin", signal });
  });
  it.each([true, false])("sends a normalized caller-owned intent with creation mode %s", async (createInitialPage) => {
    const fetch = respond(result), signal = new AbortController().signal;
    expect(await initializeServerWorkspace({ ...input, createInitialPage }, signal)).toEqual(result);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/workspace/initialize", { credentials: "same-origin", method: "POST",
      headers: { "X-Scribble-Request": "1", "Content-Type": "application/json" }, body: JSON.stringify({ requestId: requestId.toLowerCase(), createInitialPage }), signal });
  });
  it("accepts replay, accessible fallbacks and intentionally empty workspaces", async () => {
    const replay = { ...result, board: null, initialization: { ...result.initialization, replayed: true, initializedNow: false } };
    respond(replay); expect(await initializeServerWorkspace(input)).toEqual(replay);
    const last = { ...result, workspace: { ...workspace, lastOpenedBoardId: boardId }, initialization: { ...result.initialization, initializedNow: false } };
    respond(last); expect(await initializeServerWorkspace(input)).toEqual(last);
  });
  it.each([null, boardId])("updates only the nullable last-opened preference %s", async (lastOpenedBoardId) => {
    const state = { ...workspace, lastOpenedBoardId }, fetch = respond({ workspace: state });
    expect(await updateServerWorkspace({ lastOpenedBoardId })).toEqual(state);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/workspace", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ lastOpenedBoardId }),
      headers: { "X-Scribble-Request": "1", "Content-Type": "application/json" }, credentials: "same-origin" }));
  });
  it("validates inputs before sending a request", async () => {
    const fetch = respond(result);
    await expect(initializeServerWorkspace({ ...input, requestId: "bad" })).rejects.toThrow();
    await expect(initializeServerWorkspace({ ...input, createInitialPage: "false" } as never)).rejects.toThrow();
    await expect(initializeServerWorkspace({ ...input, title: "extra" } as never)).rejects.toThrow();
    await expect(updateServerWorkspace({ lastOpenedBoardId: "bad" })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{}, { workspace: { initialized: "yes", lastOpenedBoardId: null } }, { workspace: { initialized: true } },
    { workspace: { initialized: false, lastOpenedBoardId: "bad" } }])("rejects malformed state %j", async (body) => {
    respond(body); await expect(getServerWorkspace()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it.each([
    { ...result, workspace: { ...workspace, initialized: false } },
    { ...result, board: { ...result.board, id: "bad" } },
    { ...result, initialization: { ...result.initialization, requestId: boardId } },
    { ...result, initialization: { ...result.initialization, replayed: true } },
    { ...result, workspace: { ...workspace, lastOpenedBoardId: requestId.toLowerCase() } },
    { ...result, board: null, workspace: { ...workspace, lastOpenedBoardId: boardId } },
  ])("rejects invalid initialization acknowledgement %j", async (body) => {
    respond(body); await expect(initializeServerWorkspace(input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects mismatched update and unexpected successful HTTP acknowledgements", async () => {
    respond({ workspace }); await expect(updateServerWorkspace({ lastOpenedBoardId: boardId })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    respond(result, 201); await expect(initializeServerWorkspace(input)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    respond({ workspace }, 202); await expect(getServerWorkspace()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(updateServerWorkspace({ lastOpenedBoardId: null })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it.each([[404, "BOARD_NOT_FOUND"], [409, "WORKSPACE_INITIALIZATION_CONFLICT"], [429, "REQUEST_RATE_LIMIT"], [503, "WORKSPACE_UNAVAILABLE"]] as const)("preserves %s %s without automatic retry", async (status, code) => {
    const fetch = respond({ error: { code, message: "Request failed" } }, status);
    await expect(initializeServerWorkspace(input)).rejects.toMatchObject({ status, code });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps service/network failures distinct from confirmed session expiry", async () => {
    respond({}, 401); await expect(getServerWorkspace()).rejects.toBeInstanceOf(BoardSignInRequired);
    const fetch = vi.fn().mockRejectedValue(new TypeError("offline")); vi.stubGlobal("fetch", fetch);
    await expect(initializeServerWorkspace(input)).rejects.toThrow("offline"); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
