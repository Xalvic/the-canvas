import { randomUUID } from "node:crypto";
import { z } from "zod";

export const createBoardSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
});

export const renameBoardSchema = createBoardSchema;

export const boardIdSchema = z.uuid();

export type BoardMetadata = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

// HTTP handlers await either the test fixture or the PostgreSQL implementation.
export interface BoardStore {
  list(): BoardMetadata[] | Promise<BoardMetadata[]>;
  get(id: string): BoardMetadata | undefined | Promise<BoardMetadata | undefined>;
  create(title: string): BoardMetadata | Promise<BoardMetadata>;
  rename(id: string, title: string): BoardMetadata | undefined | Promise<BoardMetadata | undefined>;
  delete(id: string): boolean | Promise<boolean>;
}

export function createBoardStore() {
  // Each application instance owns its records. Restarting loses all of them.
  const boards = new Map<string, BoardMetadata>();

  return {
    list: () => [...boards.values()],
    get: (id: string) => boards.get(id),
    create: (title: string): BoardMetadata => {
      const timestamp = Date.now();
      const board = {
        id: randomUUID(),
        title,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      boards.set(board.id, board);
      return board;
    },
    rename: (id: string, title: string): BoardMetadata | undefined => {
      const board = boards.get(id);
      if (!board) return undefined;
      if (board.title === title) return board;
      const updated = { ...board, title, updatedAt: Date.now() };
      boards.set(id, updated);
      return updated;
    },
    delete: (id: string) => boards.delete(id),
  };
}
