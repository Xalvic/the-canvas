import { randomUUID } from "node:crypto";
import { z } from "zod";

export const createBoardSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
});

export const boardIdSchema = z.uuid();

export type BoardMetadata = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

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
  };
}
