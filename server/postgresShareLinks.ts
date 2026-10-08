import { createHash } from "node:crypto";
import type { BoardShareLink, Prisma, PrismaClient } from "./generated/prisma/client.js";
import { hashToken, randomToken } from "./auth.js";
import { lockBoardAccess, requireOwner } from "./boardPermissions.js";
import { HttpError } from "./errors.js";
import { createShareLinkCrypto } from "./shareLinkCrypto.js";
import type { CopyShareLinkInput, ShareLinkSettings, ShareLinkStore, UpdateShareLinkInput } from "./shareLinks.js";

function settings(row: BoardShareLink | null): ShareLinkSettings {
  return row ? { enabled: row.enabled, role: row.role as ShareLinkSettings["role"], generation: row.generation, version: row.settingsVersion }
    : { enabled: false, role: "viewer", generation: 0, version: 0 };
}
const unavailable = () => new HttpError(404, "SHARE_LINK_UNAVAILABLE", "This shared page is unavailable");

export function createPostgresShareLinkStore(prisma: PrismaClient, key: Buffer): ShareLinkStore {
  const crypto = createShareLinkCrypto(key);
  async function mutate(boardId: string, userId: string, input: CopyShareLinkInput | UpdateShareLinkInput, operation: "copy" | "update") {
    // Canonical fields, independent of caller property order; version is part
    // of the original intent and must never be silently rebased on retry.
    const payloadHash = createHash("sha256").update(JSON.stringify({
      operation, expectedVersion: input.expectedVersion,
      role: "role" in input ? input.role : null, stop: "enabled" in input,
    })).digest("hex");
    return prisma.$transaction(async (tx) => {
      await requireOwner(tx, boardId, userId);
      let row = await tx.boardShareLink.findUnique({ where: { boardId } });
      const current = settings(row);
      const receiptKey = { boardId_actorId_requestId: { boardId, actorId: userId, requestId: input.requestId } };
      const receipt = await tx.boardShareLinkReceipt.findUnique({ where: receiptKey });
      if (receipt) {
        if (receipt.payloadHash !== payloadHash) throw new HttpError(409, "SHARE_LINK_REQUEST_CONFLICT", "This link request was already used for a different intent");
        if (receipt.settingsVersion !== current.version) throw new HttpError(409, "SHARE_LINK_REQUEST_SUPERSEDED", "Link settings changed after this request. Check the current settings", { settings: current });
        return result(row, input.requestId, true, operation);
      }
      if (input.expectedVersion !== current.version) throw new HttpError(409, "SHARE_LINK_VERSION_CONFLICT", "Link settings changed. Check them before trying again", { settings: current });
      await admitMutation(tx, userId);
      if (operation === "copy" && !current.enabled) {
        if (current.generation >= 2_147_483_646) throw new HttpError(409, "SHARE_LINK_VERSION_LIMIT", "The link generation limit was reached");
        checkVersion(current.version);
        const generation = current.generation + 1, token = randomToken();
        const data = { enabled: true, role: current.role, generation, settingsVersion: current.version + 1,
          tokenHash: hashToken(token), tokenCiphertext: crypto.protect(token, boardId, generation), updatedAt: new Date() };
        row = await tx.boardShareLink.upsert({ where: { boardId }, create: { boardId, ...data }, update: data });
      } else if (operation === "update") {
        checkVersion(current.version);
        const data = { settingsVersion: current.version + 1, updatedAt: new Date(),
          ...("role" in input ? { role: input.role } : { enabled: false, tokenHash: null, tokenCiphertext: null }) };
        row = await tx.boardShareLink.upsert({ where: { boardId }, create: { boardId, ...data }, update: data });
      }
      // Recover before storing a receipt: corrupt/key-mismatched active material
      // fails without recording a false successful Copy. Stop never decrypts.
      const response = result(row, input.requestId, false, operation);
      await tx.boardShareLinkReceipt.create({ data: { boardId, actorId: userId, requestId: input.requestId, payloadHash, settingsVersion: response.settings.version } });
      return response;
    });
  }
  function result(row: BoardShareLink | null, requestId: string, replayed: boolean, operation: "copy" | "update") {
    const current = settings(row);
    if (operation !== "copy") return { settings: current, requestId, replayed };
    if (!row?.enabled || !row.tokenCiphertext || !row.tokenHash) throw unavailable();
    return { settings: current, requestId, replayed, token: crypto.recover(row.tokenCiphertext, row.tokenHash, row.boardId, row.generation) };
  }
  return {
    get(boardId, userId) {
      return prisma.$transaction(async (tx) => {
        await requireOwner(tx, boardId, userId);
        return settings(await tx.boardShareLink.findUnique({ where: { boardId } }));
      });
    },
    async copy(boardId, userId, input) {
      const response = await mutate(boardId, userId, input, "copy");
      if (typeof response.token !== "string") throw unavailable();
      return { ...response, token: response.token };
    },
    update(boardId, userId, input) { return mutate(boardId, userId, input, "update"); },
    open(token, userId) {
      return prisma.$transaction(async (tx) => {
        const digest = hashToken(token);
        const candidate = await tx.boardShareLink.findUnique({ where: { tokenHash: digest }, select: { boardId: true } });
        if (!candidate) throw unavailable();
        // Redemption intentionally bypasses access checks until the grant exists,
        // but serializes against deletion/settings/writes on the parent first.
        const [board] = await tx.$queryRaw<{ id: string; owner_id: string | null }[]>`
          SELECT id, owner_id FROM boards WHERE id = ${candidate.boardId}::uuid FOR UPDATE
        `;
        if (!board?.owner_id) throw unavailable();
        const row = await tx.boardShareLink.findUnique({ where: { boardId: board.id } });
        if (!row?.enabled || row.tokenHash !== digest) throw unavailable();
        await tx.boardShareLinkGrant.upsert({
          where: { boardId_userId: { boardId: board.id, userId } },
          create: { boardId: board.id, userId, generation: row.generation },
          update: { generation: row.generation, updatedAt: new Date() },
        });
        const access = await lockBoardAccess(tx, board.id, userId, "read");
        if (!access) throw unavailable();
        const metadata = await tx.board.findUniqueOrThrow({ where: { id: board.id } });
        return { id: metadata.id, title: metadata.title, role: access.role, createdAt: metadata.createdAt.getTime(), updatedAt: metadata.updatedAt.getTime() };
      });
    },
  };
}

function checkVersion(version: number) {
  if (version >= 2_147_483_646) throw new HttpError(409, "SHARE_LINK_VERSION_LIMIT", "The link settings limit was reached");
}
async function admitMutation(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 734621012))`;
  const [budget] = await tx.$queryRaw<{ count: number }[]>`
    SELECT count(*)::integer AS count FROM board_share_link_receipts
    WHERE actor_id = ${userId}::uuid AND created_at >= clock_timestamp() - interval '1 hour'
  `;
  if ((budget?.count ?? 0) >= 300) throw new HttpError(429, "SHARE_LINK_RATE_LIMIT", "The hourly link settings allowance was reached");
}
