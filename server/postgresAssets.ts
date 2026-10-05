import { Prisma, type BoardAsset, type PrismaClient } from "./generated/prisma/client.js";
import type { AssetMetadata, AssetStore } from "./assets.js";
import { lockBoardAccess } from "./boardPermissions.js";
import { HttpError } from "./errors.js";

const STORAGE_LOCK = 734621006;
const GLOBAL_STORAGE_BYTES = 2_000_000_000;
const BOARD_STORAGE_BYTES = 100 * 1024 * 1024;
const DAILY_UPLOAD_BYTES = 50 * 1024 * 1024;
const MONTHLY_ISSUED_BYTES = 10_000_000_000;
const MAX_BOARD_ASSETS = 100;
const MAX_HOURLY_UPLOADS = 10;
// A 100-image board renews at most ~1,400 signatures per visible hour.
// The independent monthly byte budget still bounds managed provider usage.
const MAX_HOURLY_SIGNED_READS = 1_500;

function metadata(row: BoardAsset): AssetMetadata {
  return {
    id: row.id, boardId: row.boardId, scopeBoardId: row.scopeBoardId, uploaderId: row.uploaderId,
    status: row.status as AssetMetadata["status"], byteSize: row.byteSize, mimeType: row.mimeType,
    width: row.width, height: row.height, fileId: row.providerFileId, filePath: row.providerFilePath,
    createdAt: row.createdAt.getTime(), lastReferencedAt: row.lastReferencedAt?.getTime() ?? null,
  };
}

async function storageLock(tx: Prisma.TransactionClient) {
  // Reserve before provider I/O. All asset operations take this lock before a
  // board lock; document saves take only the board lock, avoiding lock cycles.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${STORAGE_LOCK})`;
}

async function uploadAccess(tx: Prisma.TransactionClient, boardId: string, userId: string) {
  if (!await lockBoardAccess(tx, boardId, userId, "edit")) throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
}

/** Called inside the document-save transaction, after its parent-board lock.
 * A successful reference protects the asset permanently for this milestone,
 * including after later document removal. Failed saves roll this update back. */
export async function markDocumentAssets(tx: Prisma.TransactionClient, boardId: string, assetIds: string[]) {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return;
  const rows = await tx.boardAsset.findMany({
    where: { id: { in: ids }, boardId, scopeBoardId: boardId, status: "ready" }, select: { id: true },
  });
  if (rows.length !== ids.length) {
    throw new HttpError(422, "INVALID_ASSET_REFERENCE", "Every image must reference a completed image asset belonging to this board");
  }
  await tx.$executeRaw`
    UPDATE board_assets SET last_referenced_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE board_id = ${boardId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
  `;
}

export function createPostgresAssetStore(prisma: PrismaClient): AssetStore {
  return {
    async assertCanUpload(boardId, userId) {
      await prisma.$transaction((tx) => uploadAccess(tx, boardId, userId));
    },

    async reserve(boardId, userId, input) {
      return prisma.$transaction(async (tx) => {
        await storageLock(tx);
        await uploadAccess(tx, boardId, userId);
        const [totals] = await tx.$queryRaw<{ global_bytes: bigint; board_bytes: bigint; board_count: bigint; hourly_uploads: bigint; daily_bytes: bigint }[]>`
          SELECT
            COALESCE(SUM(byte_size) FILTER (WHERE status <> 'failed'), 0)::bigint AS global_bytes,
            COALESCE(SUM(byte_size) FILTER (WHERE scope_board_id = ${boardId}::uuid AND status <> 'failed'), 0)::bigint AS board_bytes,
            COUNT(*) FILTER (WHERE scope_board_id = ${boardId}::uuid AND status <> 'failed') AS board_count,
            COUNT(*) FILTER (WHERE uploader_id = ${userId}::uuid AND created_at > clock_timestamp() - interval '1 hour') AS hourly_uploads,
            COALESCE(SUM(byte_size) FILTER (WHERE uploader_id = ${userId}::uuid AND created_at > clock_timestamp() - interval '1 day'), 0)::bigint AS daily_bytes
          FROM board_assets
        `;
        if (totals!.hourly_uploads >= BigInt(MAX_HOURLY_UPLOADS) || totals!.daily_bytes + BigInt(input.byteSize) > BigInt(DAILY_UPLOAD_BYTES)) {
          throw new HttpError(429, "ASSET_UPLOAD_RATE_LIMIT", "Image uploads exceed the hourly or daily allowance");
        }
        if (totals!.global_bytes + BigInt(input.byteSize) > BigInt(GLOBAL_STORAGE_BYTES)
          || totals!.board_bytes + BigInt(input.byteSize) > BigInt(BOARD_STORAGE_BYTES)
          || totals!.board_count >= BigInt(MAX_BOARD_ASSETS)) {
          throw new HttpError(507, "ASSET_STORAGE_LIMIT", "Image storage allowance has been reached");
        }
        const row = await tx.boardAsset.create({ data: {
          id: input.id, boardId, scopeBoardId: boardId, uploaderId: userId,
          byteSize: input.byteSize, mimeType: input.mimeType, width: input.width, height: input.height,
          providerFilePath: input.filePath,
        } });
        return metadata(row);
      });
    },

    async finalize(id, userId, file) {
      return prisma.$transaction(async (tx) => {
        await storageLock(tx);
        const pending = await tx.boardAsset.findUnique({ where: { id } });
        if (!pending || pending.uploaderId !== userId || !pending.boardId) throw new HttpError(404, "ASSET_NOT_FOUND", "Image asset not found");
        await uploadAccess(tx, pending.boardId, userId);
        // Sharing changes and board deletion cannot occur after this recheck
        // until finalization commits; provider I/O happened outside the lock.
        const current = await tx.boardAsset.findUnique({ where: { id } });
        if (!current || (current.status !== "pending" && current.status !== "ready")) throw new HttpError(409, "ASSET_NOT_READY", "Image upload cannot be completed");
        if (file.size !== current.byteSize || file.filePath !== current.providerFilePath || !file.fileId) {
          throw new HttpError(502, "ASSET_PROVIDER_MISMATCH", "Image storage returned unexpected file metadata");
        }
        if (current.status === "ready") {
          if (current.providerFileId !== file.fileId) throw new HttpError(409, "ASSET_NOT_READY", "Image upload has already completed");
          return metadata(current);
        }
        return metadata(await tx.boardAsset.update({ where: { id }, data: {
          status: "ready", providerFileId: file.fileId, updatedAt: new Date(),
        } }));
      });
    },

    async getForRead(boardId, id, userId) {
      return prisma.$transaction(async (tx) => {
        await storageLock(tx);
        if (!await lockBoardAccess(tx, boardId, userId, "read")) throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
        const asset = await tx.boardAsset.findFirst({ where: { id, boardId, scopeBoardId: boardId, status: "ready" } });
        if (!asset) throw new HttpError(404, "ASSET_NOT_FOUND", "Image asset not found");
        const [time] = await tx.$queryRaw<{ hour: string; month: string; hour_end: Date; month_end: Date }[]>`
          SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD-HH24') AS hour,
            to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
            date_trunc('hour', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 hour' AS hour_end,
            date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 month' AS month_end
        `;
        const userBucket = `read:${userId}:${time!.hour}`, globalBucket = `bandwidth:${time!.month}`;
        const budgets = await tx.assetRequestBudget.findMany({ where: { bucket: { in: [userBucket, globalBucket] } } });
        if ((budgets.find((entry) => entry.bucket === userBucket)?.requestCount ?? 0) >= MAX_HOURLY_SIGNED_READS) {
          throw new HttpError(429, "ASSET_SIGN_RATE_LIMIT", "Image URL requests exceed the hourly allowance");
        }
        if ((budgets.find((entry) => entry.bucket === globalBucket)?.byteCount ?? 0n) + BigInt(asset.byteSize) > BigInt(MONTHLY_ISSUED_BYTES)) {
          throw new HttpError(429, "ASSET_BANDWIDTH_BUDGET", "The monthly image URL issuance allowance has been reached");
        }
        await tx.assetRequestBudget.upsert({ where: { bucket: userBucket },
          create: { bucket: userBucket, requestCount: 1, byteCount: asset.byteSize, expiresAt: time!.hour_end },
          update: { requestCount: { increment: 1 }, byteCount: { increment: asset.byteSize } },
        });
        await tx.assetRequestBudget.upsert({ where: { bucket: globalBucket },
          create: { bucket: globalBucket, requestCount: 1, byteCount: asset.byteSize, expiresAt: time!.month_end },
          update: { requestCount: { increment: 1 }, byteCount: { increment: asset.byteSize } },
        });
        await tx.assetRequestBudget.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } } });
        return metadata(asset);
      });
    },

    async claimAbandoned(limit) {
      return prisma.$transaction(async (tx) => {
        await storageLock(tx);
        const candidates = await tx.$queryRaw<{ id: string; board_id: string | null }[]>`
          SELECT id, board_id FROM board_assets WHERE last_referenced_at IS NULL
            AND ((status = 'pending' AND created_at < clock_timestamp() - interval '24 hours')
              OR (status = 'deleting' AND updated_at < clock_timestamp() - interval '15 minutes'))
          ORDER BY created_at, id LIMIT ${Math.max(1, Math.min(100, limit))}
        `;
        const claimed: AssetMetadata[] = [];
        for (const candidate of candidates) {
          if (candidate.board_id) await tx.$queryRaw`SELECT id FROM boards WHERE id = ${candidate.board_id}::uuid FOR UPDATE`;
          // Recheck after waiting for a save's parent lock. A committed save
          // may have protected the candidate while cleanup was waiting.
          const rows = await tx.$queryRaw<BoardAsset[]>`
            UPDATE board_assets SET status = 'deleting', updated_at = clock_timestamp()
            WHERE id = ${candidate.id}::uuid AND last_referenced_at IS NULL
              AND ((status = 'pending' AND created_at < clock_timestamp() - interval '24 hours')
                OR (status = 'deleting' AND updated_at < clock_timestamp() - interval '15 minutes'))
            RETURNING id, board_id AS "boardId", scope_board_id AS "scopeBoardId", uploader_id AS "uploaderId", status,
              byte_size AS "byteSize", mime_type AS "mimeType", width, height, provider_file_id AS "providerFileId",
              provider_file_path AS "providerFilePath", created_at AS "createdAt", updated_at AS "updatedAt", last_referenced_at AS "lastReferencedAt"
          `;
          if (rows[0]) claimed.push(metadata(rows[0]));
        }
        return claimed;
      });
    },

    async finishDelete(id) {
      await prisma.$transaction(async (tx) => {
        await storageLock(tx);
        await tx.boardAsset.updateMany({ where: { id, status: "deleting", lastReferencedAt: null }, data: { status: "failed", updatedAt: new Date() } });
      });
    },
  };
}
