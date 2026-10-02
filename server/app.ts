import express from "express";
import { boardIdSchema, createBoardSchema, createBoardStore } from "./boards.js";
import { errorHandler, HttpError } from "./errors.js";

export function createApp(boards = createBoardStore()) {
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

  app.get("/api/boards", (_req, res) => {
    res.json({ boards: boards.list() });
  });

  app.post("/api/boards", (req, res) => {
    if (!req.is("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
    }
    const input = createBoardSchema.parse(req.body);
    const board = boards.create(input.title);
    res.status(201).location(`/api/boards/${board.id}`).json({ board });
  });

  app.get("/api/boards/:id", (req, res) => {
    const id = boardIdSchema.parse(req.params.id);
    const board = boards.get(id);
    if (!board) throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
    res.json({ board });
  });

  app.use((_req, _res, next) => {
    next(new HttpError(404, "ROUTE_NOT_FOUND", "Route not found"));
  });
  app.use(errorHandler);

  return app;
}
