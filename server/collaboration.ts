import type { BoardRole } from "./boards.js";
import type { BoardDocument } from "./documents.js";
import type { CollaborationOperation } from "./contracts/collaboration.js";
import { HttpError } from "./errors.js";

export interface CollaborationStore {
  apply(boardId: string, input: CollaborationOperation, userId: string): Promise<{ document: BoardDocument; replayed: boolean } | undefined>;
  state(boardId: string, userId: string): Promise<{ revision: number; role: BoardRole } | undefined>;
}

// Per-process request bounds supplement the durable transaction receipt limit.
// Expired counters are pruned; an attacker cannot allocate an unbounded map.
export function createCollaborationRateLimit(limit: number, periodMs: number) {
  const counters = new Map<string, { count: number; expiresAt: number }>();
  return (userId: string) => {
    const now = Date.now();
    for (const [key, counter] of counters) if (counter.expiresAt <= now) counters.delete(key);
    const counter = counters.get(userId) ?? { count: 0, expiresAt: now + periodMs };
    if (counter.count >= limit || counters.size >= 2_000 && !counters.has(userId)) {
      throw new HttpError(429, "COLLABORATION_RATE_LIMIT", "Too many collaboration requests. Try again shortly");
    }
    counter.count++;
    counters.set(userId, counter);
  };
}
