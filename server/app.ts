import express from "express";
import { boardIdSchema, createBoardSchema, renameBoardSchema } from "./boards.js";
import type { BoardStore } from "./boards.js";
import { errorHandler, HttpError } from "./errors.js";

export function createApp(boards: BoardStore) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(express.json({ limit: "16kb" }));

  app.get("/api/boards", async (_req, res) => {
    res.json({ boards: await boards.list() });
  });

  app.post("/api/boards", async (req, res) => {
    if (!req.is("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
    }
    const input = createBoardSchema.parse(req.body);
    const board = await boards.create(input.title);
    res.status(201).location(`/api/boards/${board.id}`).json({ board });
  });

  app.get("/api/boards/:id", async (req, res) => {
    const id = boardIdSchema.parse(req.params.id);
    const board = await boards.get(id);
    if (!board) throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
    res.json({ board });
  });

  app.patch("/api/boards/:id", async (req, res) => {
    if (!req.is("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
    }
    const id = boardIdSchema.parse(req.params.id);
    const input = renameBoardSchema.parse(req.body);
    const board = await boards.rename(id, input.title);
    if (!board) throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
    res.json({ board });
  });

  app.delete("/api/boards/:id", async (req, res) => {
    const id = boardIdSchema.parse(req.params.id);
    if (!await boards.delete(id)) throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
    res.status(204).end();
  });

  app.use((_req, _res, next) => {
    next(new HttpError(404, "ROUTE_NOT_FOUND", "Route not found"));
  });
  app.use(errorHandler);

  return app;
}
