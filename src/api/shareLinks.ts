import { z } from "zod";
import type { AccountState } from "./auth";
import { BoardApiError, BoardSignInRequired, boardRequest, boardSchema, expectedAccountHeaders, mutation, parseResponse } from "./boards";

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const counter = z.number().int().min(0).max(2_147_483_646);
const role = z.enum(["viewer", "editor"]);
const settingsSchema = z.object({ enabled: z.boolean(), role, generation: counter, version: counter });
const requestIdentity = { requestId: z.uuid().transform((value) => value.toLowerCase()), expectedVersion: counter };
const copyInput = z.strictObject(requestIdentity);
const updateInput = z.union([
  z.strictObject({ ...requestIdentity, role }),
  z.strictObject({ ...requestIdentity, enabled: z.literal(false) }),
]);
const mutationResponse = z.object({ settings: settingsSchema, requestId: z.uuid(), replayed: z.boolean() });
const copyResponse = mutationResponse.extend({ token: tokenSchema });
export type ShareLinkSettings = z.output<typeof settingsSchema>;
export type CopyShareLinkIntent = z.input<typeof copyInput>;
export type UpdateShareLinkIntent = z.input<typeof updateInput>;

function accountId(account: AccountState) {
  if (account.status !== "signed-in") throw new BoardSignInRequired();
  if (!account.shareLinksEnabled) throw new BoardApiError(503, "SHARE_LINKS_UNSUPPORTED", "Link sharing is unavailable on this server");
  return account.user.id;
}
const endpoint = (boardId: string) => `/api/boards/${z.uuid().parse(boardId).toLowerCase()}/share-link`;
const invalid = () => new BoardApiError(200, "INVALID_RESPONSE", "The server returned an invalid link response");

export async function getShareLink(boardId: string, account: AccountState, signal?: AbortSignal) {
  const ownerId = accountId(account);
  const response = await boardRequest(endpoint(boardId), { signal, ...expectedAccountHeaders(ownerId) }, "Could not check link settings");
  return (await parseResponse(response, z.object({ settings: settingsSchema }))).settings;
}

// The caller owns this intent across uncertain failures. Neither wrapper retries,
// replaces requestId, nor rebases expectedVersion; this preserves Stop and newer roles.
export async function copyShareLink(boardId: string, intent: CopyShareLinkIntent, account: AccountState, signal?: AbortSignal) {
  const ownerId = accountId(account), input = copyInput.parse(intent);
  const response = await boardRequest(`${endpoint(boardId)}/copy`, mutation("POST", signal, input, ownerId), "Could not prepare the shared link");
  const result = await parseResponse(response, copyResponse);
  if (result.requestId !== input.requestId || !result.settings.enabled || result.settings.generation < 1) throw invalid();
  return result;
}

export async function updateShareLink(boardId: string, intent: UpdateShareLinkIntent, account: AccountState, signal?: AbortSignal) {
  const ownerId = accountId(account), input = updateInput.parse(intent);
  const response = await boardRequest(endpoint(boardId), mutation("PATCH", signal, input, ownerId), "Could not change link settings");
  const result = await parseResponse(response, mutationResponse);
  if (result.requestId !== input.requestId || ("role" in input ? result.settings.role !== input.role : result.settings.enabled)) throw invalid();
  return result;
}

export async function openShareLink(token: string, account: AccountState, signal?: AbortSignal) {
  const ownerId = accountId(account);
  const response = await boardRequest("/api/share-links/open", mutation("POST", signal, { token: tokenSchema.parse(token) }, ownerId), "Could not open this shared page");
  return (await parseResponse(response, z.object({ board: boardSchema.extend({ id: z.uuid(), role: z.enum(["owner", "editor", "viewer"]) }) }))).board;
}

export function shareLinkUrl(token: string, origin = window.location.origin, baseUrl = import.meta.env.BASE_URL) {
  const host = new URL(origin);
  if (!["https:", "http:"].includes(host.protocol) || host.username || host.password || !baseUrl.startsWith("/") || baseUrl.startsWith("//")) throw invalid();
  const url = new URL(baseUrl, host.origin);
  if (url.origin !== host.origin || url.search || url.hash) throw invalid();
  url.hash = `share=${tokenSchema.parse(token)}`;
  return url.href;
}
