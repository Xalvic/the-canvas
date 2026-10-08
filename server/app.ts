import express from "express";
import { boardIdSchema, createBoardSchema, renameBoardSchema } from "./boards.js";
import type { BoardStore } from "./boards.js";
import { errorHandler, HttpError } from "./errors.js";
import { DOCUMENT_BODY_LIMIT, saveDocumentSchema, type BoardDocumentStore } from "./documents.js";
import { createAuthRouter, type AuthDependencies } from "./authRoutes.js";
import { requireBoardSession } from "./boardAccess.js";
import { inviteSchema, memberUpdateSchema, type SharingStore } from "./sharing.js";
import { createUploadGate, type ImageAssetService } from "./imageAssets.js";
import { MAX_IMAGE_BYTES } from "./imageValidation.js";
import type { CollaborationStore } from "./collaboration.js";
import { createCollaborationRouter } from "./collaborationRoutes.js";
import { checkReady, productionRequestGuard, productionUserBudget, verifyProductionOrigin, type ProductionDependencies } from "./production.js";
import { initializeWorkspaceSchema, updateWorkspaceSchema, type WorkspaceStore } from "./workspace.js";
import type { ShareLinkStore } from "./shareLinks.js";
import { createShareLinkRouter } from "./shareLinkRoutes.js";

export function createApp(boards: BoardStore, documents?: BoardDocumentStore, auth?: AuthDependencies, sharing?: SharingStore, assets?: ImageAssetService, collaboration?: CollaborationStore, production?: ProductionDependencies, workspace?: WorkspaceStore, shareLinks?: ShareLinkStore) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  if (production) {
    app.get("/ready", async (req, res) => {
      verifyProductionOrigin(req, res, production.proxySecret);
      try { await checkReady(production.ready); res.json({ status: "ready" }); }
      catch { res.status(503).json({ status: "unavailable" }); }
    });
    app.use("/api", productionRequestGuard(production));
  }
  app.use("/api/auth", createAuthRouter(auth, production, Boolean(shareLinks)));
  app.use("/api/boards", requireBoardSession(auth));
  app.use("/api/workspace", requireBoardSession(auth));
  app.use("/api/share-links", requireBoardSession(auth));
  if (sharing) app.use("/api/invitations", requireBoardSession(auth));
  if (production) {
    app.use("/api/boards", productionUserBudget(production));
    app.use("/api/workspace", productionUserBudget(production));
    app.use("/api/share-links", productionUserBudget(production));
    if (sharing) app.use("/api/invitations", productionUserBudget(production));
  }

  if (assets) {
    const acquire = createUploadGate();
    const parseImage = express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: MAX_IMAGE_BYTES, inflate: false });
    app.post("/api/boards/:id/assets", async (req, res) => {
      const id = boardIdSchema.parse(req.params.id).toLowerCase();
      await assets.authorizeUpload(id, res.locals.ownerId);
      const requestId = req.get("X-Scribble-Upload-Request");
      const uploadRequestId = requestId === undefined ? undefined : boardIdSchema.parse(requestId).toLowerCase();
      const type = req.get("Content-Type")?.toLowerCase();
      if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type)) {
        throw new HttpError(415, "UNSUPPORTED_IMAGE_TYPE", "Send raw JPEG, PNG or WebP bytes with the matching Content-Type");
      }
      const release = acquire(res.locals.ownerId);
      try {
        const bodyTimer = setTimeout(() => req.destroy(), 30_000);
        bodyTimer.unref();
        try {
          await new Promise<void>((resolve, reject) => parseImage(req, res, (error?: unknown) => error ? reject(error) : resolve()));
        } finally { clearTimeout(bodyTimer); }
        const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (uploadRequestId) {
          const upload = await assets.uploadRequest(id, res.locals.ownerId, uploadRequestId, buffer, type);
          if (upload.state === "pending") res.set("Retry-After", String(Math.ceil(upload.retryAfterMs! / 1000)));
          res.status(upload.state === "ready" ? 200 : 202).location(`/api/boards/${id}/asset-uploads/${uploadRequestId}`).json({ upload });
        } else {
          const asset = await assets.upload(id, res.locals.ownerId, buffer, type);
          res.status(201).location(`/api/boards/${id}/assets/${asset.id}`).json({ asset });
        }
      } finally { release(); }
    });
    app.get("/api/boards/:id/asset-uploads/:requestId", async (req, res) => {
      const id = boardIdSchema.parse(req.params.id).toLowerCase();
      const requestId = boardIdSchema.parse(req.params.requestId).toLowerCase();
      const upload = await assets.uploadStatus(id, res.locals.ownerId, requestId);
      if (upload.state === "pending") res.set("Retry-After", String(Math.ceil(upload.retryAfterMs! / 1000)));
      res.json({ upload });
    });
    app.get("/api/boards/:id/assets/:assetId", async (req, res) => {
      const id = boardIdSchema.parse(req.params.id);
      const assetId = boardIdSchema.parse(req.params.assetId);
      res.json({ asset: await assets.read(id, assetId, res.locals.ownerId) });
    });
  }

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

  if (collaboration) app.use("/api/boards/:id", createCollaborationRouter(collaboration, auth));
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", createShareLinkRouter(shareLinks, production));

  function requireWorkspace() {
    if (!workspace) throw new HttpError(503, "WORKSPACE_UNAVAILABLE", "Workspace state is unavailable");
    return workspace;
  }
  app.get("/api/workspace", async (_req, res) => {
    res.json({ workspace: await requireWorkspace().get(res.locals.ownerId) });
  });
  app.patch("/api/workspace", async (req, res) => {
    if (!req.is("application/json")) throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
    res.json({ workspace: await requireWorkspace().update(updateWorkspaceSchema.parse(req.body), res.locals.ownerId) });
  });
  app.post("/api/workspace/initialize", async (req, res) => {
    if (!req.is("application/json")) throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
    res.json(await requireWorkspace().initialize(initializeWorkspaceSchema.parse(req.body), res.locals.ownerId));
  });

  if (sharing) {
    app.get("/api/invitations", async (_req, res) => {
      res.json({ invitations: await sharing.incoming(res.locals.ownerId, res.locals.userEmail) });
    });
    app.post("/api/invitations/:inviteId/accept", async (req, res) => {
      const id = boardIdSchema.parse(req.params.inviteId);
      res.json({ board: await sharing.accept(id, res.locals.ownerId, res.locals.userEmail) });
    });
    app.delete("/api/invitations/:inviteId", async (req, res) => {
      await sharing.decline(boardIdSchema.parse(req.params.inviteId), res.locals.ownerId, res.locals.userEmail);
      res.status(204).end();
    });
    app.get("/api/boards/:id/sharing", async (req, res) => {
      res.json(await sharing.get(boardIdSchema.parse(req.params.id), res.locals.ownerId));
    });
    app.post("/api/boards/:id/invitations", async (req, res) => {
      if (!req.is("application/json")) throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
      const invite = await sharing.invite(boardIdSchema.parse(req.params.id), res.locals.ownerId, inviteSchema.parse(req.body));
      res.status(201).json({ invitation: invite });
    });
    app.delete("/api/boards/:id/invitations/:inviteId", async (req, res) => {
      await sharing.cancel(boardIdSchema.parse(req.params.id), res.locals.ownerId, boardIdSchema.parse(req.params.inviteId));
      res.status(204).end();
    });
    app.patch("/api/boards/:id/members/:userId", async (req, res) => {
      if (!req.is("application/json")) throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
      await sharing.updateMember(boardIdSchema.parse(req.params.id), res.locals.ownerId, boardIdSchema.parse(req.params.userId), memberUpdateSchema.parse(req.body).role);
      res.status(204).end();
    });
    app.delete("/api/boards/:id/members/:userId", async (req, res) => {
      await sharing.removeMember(boardIdSchema.parse(req.params.id), res.locals.ownerId, boardIdSchema.parse(req.params.userId));
      res.status(204).end();
    });
  }

  app.get("/api/boards", async (_req, res) => {
    res.json({ boards: await boards.list(res.locals.ownerId) });
  });

  app.post("/api/boards", async (req, res) => {
    if (!req.is("application/json")) {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
    }
    const input = createBoardSchema.parse(req.body);
    if ("requestId" in input) {
      if (!boards.createPage) throw new HttpError(503, "PAGE_CREATION_UNAVAILABLE", "Retry-safe page creation is unavailable");
      const result = await boards.createPage(input, res.locals.ownerId);
      res.status(result.creation.replayed ? 200 : 201).location(`/api/boards/${result.board.id}`).json(result);
      return;
    }
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
