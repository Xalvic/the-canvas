import { randomUUID } from "node:crypto";
import { z } from "zod";

export const createBoardSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
});

export const renameBoardSchema = createBoardSchema;

export const boardIdSchema = z.uuid();

export type BoardRole = "owner" | "editor" | "viewer";
export type BoardMetadata = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  role?: BoardRole;
};

// HTTP handlers await either the test fixture or the PostgreSQL implementation.
export interface BoardStore {
  list(ownerId: string): BoardMetadata[] | Promise<BoardMetadata[]>;
  get(id: string, ownerId: string): BoardMetadata | undefined | Promise<BoardMetadata | undefined>;
  create(title: string, ownerId: string): BoardMetadata | Promise<BoardMetadata>;
  rename(id: string, title: string, ownerId: string): BoardMetadata | undefined | Promise<BoardMetadata | undefined>;
  delete(id: string, ownerId: string): boolean | Promise<boolean>;
}

export function createBoardStore() {
  // Each application instance owns its records. Restarting loses all of them.
  const boards = new Map<string, BoardMetadata>();
  const owners = new Map<string, string>();

  return {
    list: (ownerId: string) => [...boards.values()].filter((board) => owners.get(board.id) === ownerId),
    get: (id: string, ownerId: string) => owners.get(id) === ownerId ? boards.get(id) : undefined,
    create: (title: string, ownerId: string): BoardMetadata => {
      const timestamp = Date.now();
      const board: BoardMetadata = {
        id: randomUUID(),
        title,
        createdAt: timestamp,
        updatedAt: timestamp,
        role: "owner",
      };
      boards.set(board.id, board);
      owners.set(board.id, ownerId);
      return board;
    },
    rename: (id: string, title: string, ownerId: string): BoardMetadata | undefined => {
      const board = boards.get(id);
      if (!board || owners.get(id) !== ownerId) return undefined;
      if (board.title === title) return board;
      const updated = { ...board, title, updatedAt: Date.now() };
      boards.set(id, updated);
      return updated;
    },
    delete: (id: string, ownerId: string) => {
      if (owners.get(id) !== ownerId) return false;
      owners.delete(id);
      return boards.delete(id);
    },
  };
}
