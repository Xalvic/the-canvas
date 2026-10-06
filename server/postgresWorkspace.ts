import type { Prisma, PrismaClient, WorkspaceState as WorkspaceRow } from "./generated/prisma/client.js";
import type { BoardMetadata } from "./boards.js";
import { lockBoardAccess } from "./boardPermissions.js";
import { createBlankPage, lockBoardActor } from "./postgresBoards.js";
import { HttpError } from "./errors.js";
import type { WorkspaceState, WorkspaceStore } from "./workspace.js";

async function accessibleBoard(tx: Prisma.TransactionClient, boardId: string, userId: string): Promise<BoardMetadata | null> {
  const access = await lockBoardAccess(tx, boardId, userId, "read", "share");
  if (!access) return null;
  const row = await tx.board.findUniqueOrThrow({ where: { id: boardId } });
  return { id: row.id, title: row.title, role: access.role, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() };
}

async function state(tx: Prisma.TransactionClient, row: WorkspaceRow | null, userId: string): Promise<WorkspaceState> {
  // Mask revoked preferences without writing during GET. Deletion clears the FK.
  const last = row?.lastOpenedBoardId ? await accessibleBoard(tx, row.lastOpenedBoardId, userId) : null;
  return { initialized: row?.initializedAt !== null && row?.initializedAt !== undefined, lastOpenedBoardId: last?.id ?? null };
}

async function openingCandidate(tx: Prisma.TransactionClient, userId: string, lastOpenedBoardId: string | null): Promise<BoardMetadata | null> {
  if (lastOpenedBoardId) {
    const last = await accessibleBoard(tx, lastOpenedBoardId, userId);
    if (last) return last;
  }
  // Match list access semantics: pending invitations and ownerless legacy boards
  // do not count. Stable ordering prefers owned pages, then oldest creation/id.
  for (;;) {
    const candidates = await tx.$queryRaw<{ id: string }[]>`
      SELECT b.id FROM boards b LEFT JOIN board_members m ON m.board_id = b.id AND m.user_id = ${userId}::uuid
      WHERE b.owner_id IS NOT NULL AND (b.owner_id = ${userId}::uuid OR m.role IN ('editor', 'viewer'))
      ORDER BY (b.owner_id = ${userId}::uuid) DESC, b.created_at, b.id LIMIT 1 FOR SHARE OF b
    `;
    const candidate = candidates[0];
    if (!candidate) return null;
    // Recheck after acquiring the parent lock; a sharing mutation may have
    // committed since the candidate query. Never return revoked metadata.
    const board = await accessibleBoard(tx, candidate.id, userId);
    if (board) return board;
  }
}

export function createPostgresWorkspaceStore(prisma: PrismaClient): WorkspaceStore {
  return {
    get(userId) {
      return prisma.$transaction(async (tx) => state(tx, await tx.workspaceState.findUnique({ where: { userId } }), userId));
    },
    update(input, userId) {
      return prisma.$transaction(async (tx) => {
        await lockBoardActor(tx, userId);
        if (input.lastOpenedBoardId && !await accessibleBoard(tx, input.lastOpenedBoardId, userId)) {
          throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
        }
        // Updating a preference alone is not first initialization.
        const row = await tx.workspaceState.upsert({
          where: { userId }, create: { userId, ...input }, update: input,
        });
        return { initialized: row.initializedAt !== null, lastOpenedBoardId: row.lastOpenedBoardId };
      });
    },
    initialize(input, userId) {
      return prisma.$transaction(async (tx) => {
        await lockBoardActor(tx, userId);
        const key = { actorId_requestId: { actorId: userId, requestId: input.requestId } };
        const receipt = await tx.workspaceInitializationReceipt.findUnique({ where: key });
        if (receipt && receipt.createInitialPage !== input.createInitialPage) {
          throw new HttpError(409, "WORKSPACE_INITIALIZATION_CONFLICT", "This initialization request was already used with a different payload");
        }
        const row = await tx.workspaceState.findUnique({ where: { userId } });
        const workspace = await state(tx, row, userId);
        let board = await openingCandidate(tx, userId, workspace.lastOpenedBoardId);
        const initializedNow = !workspace.initialized;
        if (initializedNow) {
          if (!board && input.createInitialPage) board = await createBlankPage(tx, "Untitled", userId);
          // Use the database clock; preferences only change after successful open.
          await tx.$executeRaw`
            INSERT INTO workspace_states(user_id, initialized_at) VALUES(${userId}::uuid, clock_timestamp())
            ON CONFLICT(user_id) DO UPDATE SET initialized_at = EXCLUDED.initialized_at
          `;
          workspace.initialized = true;
        }
        if (!receipt) await tx.workspaceInitializationReceipt.create({ data: { actorId: userId, ...input } });
        return { workspace, board, initialization: { requestId: input.requestId, replayed: !!receipt, initializedNow } };
      });
    },
  };
}
