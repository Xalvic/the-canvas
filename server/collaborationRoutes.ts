import { Router, json, type Request } from "express";
import { z } from "zod";
import { boardIdSchema } from "./boards.js";
import { presenceSchema, collaborationOperationSchema, type BoardPresence } from "./contracts/collaboration.js";
import { createCollaborationRateLimit, type CollaborationStore } from "./collaboration.js";
import { HttpError } from "./errors.js";
import type { AuthDependencies } from "./authRoutes.js";
import { SESSION_COOKIE, hashToken, readTokenCookie, type AuthUser } from "./auth.js";

const streamQuerySchema = z.strictObject({ clientId: z.uuid() });
type Participant = BoardPresence & { userId: string; displayName: string | null; expiresAt: number };
const presenceKey = (boardId: string, userId: string, clientId: string) => `${boardId}:${userId}:${clientId}`;

// Presence is intentionally ephemeral and belongs to one Express instance.
// Revision polling reads PostgreSQL, including saves from another instance.
export class CollaborationPresence {
  private participants = new Map<string, { boardId: string; participant: Participant }>();
  update(boardId: string, user: AuthUser, input: BoardPresence) {
    this.prune();
    const key = presenceKey(boardId, user.id, input.clientId);
    if (!this.participants.has(key) && (this.participants.size >= 256 ||
        [...this.participants.values()].filter((entry) => entry.participant.userId === user.id).length >= 8 ||
        [...this.participants.values()].filter((entry) => entry.boardId === boardId).length >= 32)) {
      throw new HttpError(429, "PRESENCE_LIMIT", "This board has reached its live presence limit");
    }
    const entry = { boardId, participant: { ...input, userId: user.id, displayName: user.displayName, expiresAt: Date.now() + 30_000 } };
    const candidates = [...this.participants.entries()].filter(([candidateKey, value]) => candidateKey !== key && value.boardId === boardId).map(([, value]) => value.participant);
    if (Buffer.byteLength(JSON.stringify([...candidates, entry.participant])) > 32 * 1024) throw new HttpError(429, "PRESENCE_LIMIT", "This board has reached its live presence size limit");
    this.participants.set(key, entry);
  }
  touch(boardId: string, userId: string, clientId: string) {
    const entry = this.participants.get(presenceKey(boardId, userId, clientId));
    if (entry) entry.participant.expiresAt = Date.now() + 30_000;
  }
  remove(boardId: string, userId: string, clientId: string) { this.participants.delete(presenceKey(boardId, userId, clientId)); }
  private prune() { for (const [key, entry] of this.participants) if (entry.participant.expiresAt <= Date.now()) this.participants.delete(key); }
  list(boardId: string) {
    this.prune();
    return [...this.participants.values()].filter((entry) => entry.boardId === boardId).map(({ participant: { expiresAt: _expiry, ...participant } }) => participant);
  }
}

export function createCollaborationRouter(store: CollaborationStore, auth?: AuthDependencies, options: { pollIntervalMs?: number } = {}) {
  const router = Router({ mergeParams: true });
  const presence = new CollaborationPresence();
  const operationRate = createCollaborationRateLimit(300, 60_000);
  const presenceRate = createCollaborationRateLimit(10, 1_000);
  const streamRate = createCollaborationRateLimit(30, 60_000);
  const streams = new Set<{ boardId: string; userId: string; clientId: string; close: () => void }>();
  async function session(req: Request) {
    const token = readTokenCookie(req.headers.cookie, SESSION_COOKIE);
    return token && auth ? auth.store.getSession(hashToken(token)) : undefined;
  }
  const requireJson = (req: Request) => {
    if (!req.is("application/json")) throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
  };

  router.post<{ id: string }>("/operations", json({ limit: "2mb", inflate: false }), async (req, res) => {
    requireJson(req);
    const boardId = boardIdSchema.parse(req.params.id);
    operationRate(res.locals.ownerId);
    const input = collaborationOperationSchema.parse(req.body);
    const result = await store.apply(boardId, input, res.locals.ownerId);
    if (!result) throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
    res.json(result);
  });

  router.post<{ id: string }>("/presence", json({ limit: "16kb", inflate: false }), async (req, res) => {
    requireJson(req);
    const boardId = boardIdSchema.parse(req.params.id);
    presenceRate(res.locals.ownerId);
    const input = presenceSchema.parse(req.body);
    const current = await session(req);
    if (!current || current.expiresAt <= Date.now()) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue");
    const access = await store.state(boardId, res.locals.ownerId);
    if (!access) throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
    presence.update(boardId, current.user, input);
    res.status(204).end();
  });

  router.get<{ id: string }>("/events", async (req, res) => {
    const boardId = boardIdSchema.parse(req.params.id);
    const { clientId } = streamQuerySchema.parse(req.query);
    const userId: string = res.locals.ownerId;
    streamRate(userId);
    const access = await store.state(boardId, userId);
    if (!access) throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
    const current = await session(req);
    if (!current || current.expiresAt <= Date.now()) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue");
    // A reconnect replaces the same browser's old stream.
    for (const stream of streams) if (stream.boardId === boardId && stream.userId === userId && stream.clientId === clientId) stream.close();
    if (streams.size >= 256 || [...streams].filter((stream) => stream.userId === userId).length >= 8 ||
        [...streams].filter((stream) => stream.boardId === boardId).length >= 32) {
      throw new HttpError(429, "PRESENCE_LIMIT", "Too many active collaboration streams");
    }
    presence.update(boardId, current.user, { clientId, cursor: null, selectedIds: [] });
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" });
    res.flushHeaders();
    let closed = false, polling = false;
    let revision = -1, role = "", previousPresence = "", heartbeatAt = Date.now(), blockedAt = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      streams.delete(stream);
      presence.remove(boardId, userId, clientId);
      res.end();
    };
    const stream = { boardId, userId, clientId, close };
    const send = (event: string, data: unknown) => {
      if (closed || res.destroyed || res.writableLength > 64 * 1024) { close(); return; }
      // A bounded frame may briefly exceed the socket's high-water mark. Stop
      // enqueueing until it drains; terminate persistently slow consumers.
      if (!res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) blockedAt ||= Date.now();
    };
    const poll = async () => {
      if (closed || polling) return;
      polling = true;
      try {
        const freshSession = await session(req);
        if (closed) return;
        if (!freshSession || freshSession.expiresAt <= Date.now() || freshSession.user.id !== userId) { send("access", { code: "UNAUTHENTICATED" }); close(); return; }
        const fresh = await store.state(boardId, userId);
        if (closed) return;
        if (!fresh) { send("access", { code: "BOARD_NOT_FOUND" }); close(); return; }
        presence.touch(boardId, userId, clientId);
        if (res.writableNeedDrain) {
          blockedAt ||= Date.now();
          if (Date.now() - blockedAt >= 5_000) close();
          return;
        }
        blockedAt = 0;
        if (revision !== fresh.revision || role !== fresh.role) {
          revision = fresh.revision; role = fresh.role;
          send("revision", fresh);
        }
        const participants = presence.list(boardId);
        const serialized = JSON.stringify(participants);
        if (serialized !== previousPresence) { previousPresence = serialized; send("presence", { participants }); }
        if (Date.now() - heartbeatAt >= 15_000) {
          heartbeatAt = Date.now();
          if (!closed && !res.write(": heartbeat\n\n")) blockedAt ||= Date.now();
        }
      } catch { close(); } finally { polling = false; }
    };
    streams.add(stream);
    res.on("close", close);
    timer = setInterval(() => { void poll(); }, options.pollIntervalMs ?? 1_000);
    timer.unref();
    await poll();
  });
  return router;
}
