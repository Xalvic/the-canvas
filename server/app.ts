import express from "express";
import { boardIdSchema, createBoardSchema, renameBoardSchema } from "./boards.js";
import type { BoardStore } from "./boards.js";
import { errorHandler, HttpError } from "./errors.js";
import { DOCUMENT_BODY_LIMIT, saveDocumentSchema, type BoardDocumentStore } from "./documents.js";
import { createAuthRouter, type AuthDependencies } from "./authRoutes.js";
import { requireBoardSession } from "./boardAccess.js";

export function createApp(boards: BoardStore, documents?: BoardDocumentStore, auth?: AuthDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api/auth", createAuthRouter(auth));
  app.use("/api/boards", requireBoardSession(auth));

  // Document PUT gets its own parser before the smaller metadata parser.
  if (documents) {
    app.get("/api/boards/:id/document", async (req, res) => {
      const id = boardIdSchema.parse(req.params.id);
      const result = await documents.get(id, res.locals.ownerId);
      if (result.status === "board-not-found") throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
      if (result.status === "document-not-found") throw new HttpError(404, "DOCUMENT_NOT_FOUND", "This board has no saved document");
      res.json({ document: result.document });
    });

    app.put("/api/boards/:id/document", express.json({ limit: DOCUMENT_BODY_LIMIT }), async (req, res) => {
      if (!req.is("application/json")) {
        throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
      }
      const id = boardIdSchema.parse(req.params.id);
      const input = saveDocumentSchema.parse(req.body);
      const result = await documents.save(id, input, res.locals.ownerId);
      if (result.status === "board-not-found") throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
      if (result.status === "conflict") {
        throw new HttpError(409, "REVISION_CONFLICT", "Document revision does not match", { currentRevision: result.currentRevision });
      }
      if (result.created) res.location(`/api/boards/${id}/document`);
      res.status(result.created ? 201 : 200).json({ document: result.document });
    });
  }

  app.use(express.json({ limit: "16kb" }));

  app.get("/api/boards", async (_req, res) => {
    res.json({ boards: await boards.list(res.locals.ownerId) });
  });

  app.post("/api/boards", async (req, res) => {
    if (!req.is("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
    }
    const input = createBoardSchema.parse(req.body);
    const board = await boards.create(input.title, res.locals.ownerId);
    res.status(201).location(`/api/boards/${board.id}`).json({ board });
  });

  app.get("/api/boards/:id", async (req, res) => {
    const id = boardIdSchema.parse(req.params.id);
    const board = await boards.get(id, res.locals.ownerId);
    if (!board) throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
    res.json({ board });
  });

  app.patch("/api/boards/:id", async (req, res) => {
    if (!req.is("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
    }
    const id = boardIdSchema.parse(req.params.id);
    const input = renameBoardSchema.parse(req.body);
    const board = await boards.rename(id, input.title, res.locals.ownerId);
    if (!board) throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
    res.json({ board });
  });

  app.delete("/api/boards/:id", async (req, res) => {
    const id = boardIdSchema.parse(req.params.id);
    if (!await boards.delete(id, res.locals.ownerId)) throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
    res.status(204).end();
  });

  app.use((_req, _res, next) => {
    next(new HttpError(404, "ROUTE_NOT_FOUND", "Route not found"));
  });
  app.use(errorHandler);

  return app;
}
