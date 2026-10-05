import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PrismaClient } from "./generated/prisma/client.js";
import { cloudDocumentSchema, documentAssetIds } from "./contracts/cloudDocument.js";
import { MAX_COLLABORATION_REVISION } from "./contracts/collaboration.js";
import type { CollaborationStore } from "./collaboration.js";
import type { BoardDocument } from "./documents.js";
import type { BoardRole } from "./boards.js";
import { boardRoleSql, lockBoardAccess } from "./boardPermissions.js";
import { markDocumentAssets } from "./postgresAssets.js";
import { HttpError } from "./errors.js";

// JSONB does not retain object-property order. Both equality and idempotency
// hashing must compare values rather than JavaScript insertion order.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function createPostgresCollaborationStore(prisma: PrismaClient): CollaborationStore {
  return {
    async state(boardId, userId) {
      const rows = await prisma.$queryRaw<{ revision: number; role: BoardRole }[]>`
        SELECT COALESCE(d.revision, 0) AS revision, ${boardRoleSql(userId)} AS role
        FROM boards b LEFT JOIN board_documents d ON d.board_id = b.id
        LEFT JOIN board_members m ON m.board_id = b.id AND m.user_id = ${userId}::uuid
        WHERE b.id = ${boardId}::uuid AND b.owner_id IS NOT NULL
          AND (b.owner_id = ${userId}::uuid OR m.role IN ('editor', 'viewer'))
      `;
      return rows[0];
    },
    async apply(boardId, input, userId) {
      const payloadHash = createHash("sha256").update(canonicalJson(input)).digest("hex");
      return prisma.$transaction(async (tx) => {
        const access = await lockBoardAccess(tx, boardId, userId, "edit");
        if (!access) return undefined;
        const current = await tx.boardDocument.findUnique({ where: { boardId } });
        const revision = current?.revision ?? 0;
        const parsed = cloudDocumentSchema.safeParse(current
          ? { schemaVersion: current.schemaVersion, content: current.content }
          : { schemaVersion: 1, content: { objects: [] } });
        if (!parsed.success) throw new HttpError(500, "INVALID_STORED_DOCUMENT", "The saved document has an unsupported or invalid format");
        const document = (): BoardDocument => ({ ...parsed.data, boardId, revision, updatedAt: current?.updatedAt.getTime() ?? Date.now(), role: access.role });
        const receipts = await tx.$queryRaw<{ payload_hash: string; applied_revision: number }[]>`
          SELECT payload_hash, applied_revision FROM board_operation_receipts
          WHERE board_id = ${boardId}::uuid AND actor_id = ${userId}::uuid AND operation_id = ${input.operationId}::uuid
        `;
        if (receipts[0]) {
          if (receipts[0].payload_hash !== payloadHash) throw new HttpError(409, "OPERATION_ID_REUSED", "An operation ID cannot be reused for different changes");
          // Authorize first, then return today's document, never replay a write.
          return { document: document(), replayed: true };
        }
        const byId = new Map(parsed.data.content.objects.map((object) => [object.id, object]));
        const conflictingObjectIds = input.changes.filter((change) => !isDeepStrictEqual(byId.get(change.id) ?? null, change.before)).map(({ id }) => id);
        if (input.baseRevision > revision || conflictingObjectIds.length) throw new HttpError(409, "COLLABORATION_CONFLICT", "Some changed objects no longer match their starting state", { currentRevision: revision, conflictingObjectIds });
        if (revision >= MAX_COLLABORATION_REVISION) throw new HttpError(409, "COLLABORATION_CONFLICT", "The document revision limit was reached", { currentRevision: revision, conflictingObjectIds: [] });
        for (const change of input.changes) {
          if (change.after === null) byId.delete(change.id);
          else byId.set(change.id, change.after);
        }
        const merged = cloudDocumentSchema.parse({ schemaVersion: 1, content: { objects: [...byId.values()] } });
        if (Buffer.byteLength(JSON.stringify(merged)) > 1024 * 1024) throw new HttpError(413, "DOCUMENT_TOO_LARGE", "The merged document exceeds 1 MB");
        // Board first, then actor budget: all operation writers take these in
        // this order. Receipts remain durable; no TTL can resurrect an old retry.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 734621007))`;
        const [budget] = await tx.$queryRaw<{ count: number }[]>`
          SELECT count(*)::integer AS count FROM board_operation_receipts
          WHERE actor_id = ${userId}::uuid AND created_at >= clock_timestamp() - interval '1 hour'
        `;
        if ((budget?.count ?? 0) >= 3_600) throw new HttpError(429, "COLLABORATION_RATE_LIMIT", "The hourly collaboration operation allowance was reached");
        await markDocumentAssets(tx, boardId, documentAssetIds(merged));
        const content = JSON.stringify(merged.content);
        const rows = await tx.$queryRaw<{ revision: number; updated_at: Date }[]>`
          INSERT INTO board_documents (board_id, schema_version, revision, content, updated_at)
          VALUES (${boardId}::uuid, 1, 1, ${content}::jsonb,
            (SELECT GREATEST(clock_timestamp(), updated_at) FROM boards WHERE id = ${boardId}::uuid))
          ON CONFLICT (board_id) DO UPDATE SET revision = board_documents.revision + 1,
            content = EXCLUDED.content,
            updated_at = GREATEST(clock_timestamp(), board_documents.updated_at, EXCLUDED.updated_at)
          RETURNING revision, updated_at
        `;
        await tx.$executeRaw`
          UPDATE boards SET updated_at = (SELECT updated_at FROM board_documents WHERE board_id = ${boardId}::uuid)
          WHERE id = ${boardId}::uuid
        `;
        await tx.$executeRaw`
          INSERT INTO board_operation_receipts (board_id, actor_id, operation_id, payload_hash, applied_revision)
          VALUES (${boardId}::uuid, ${userId}::uuid, ${input.operationId}::uuid, ${payloadHash}, ${rows[0]!.revision})
        `;
        return { document: { ...merged, boardId, revision: rows[0]!.revision, updatedAt: rows[0]!.updated_at.getTime(), role: access.role }, replayed: false };
      });
    },
  };
}
