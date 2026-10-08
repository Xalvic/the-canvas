import { Router, type RequestHandler } from "express";
import { boardIdSchema } from "./boards.js";
import { createCollaborationRateLimit } from "./collaboration.js";
import { HttpError } from "./errors.js";
import { enforceShareLinkBudget, type ProductionDependencies } from "./production.js";
import { copyShareLinkSchema, openShareLinkSchema, updateShareLinkSchema, type ShareLinkStore } from "./shareLinks.js";

export function createShareLinkRouter(store?: ShareLinkStore, production?: ProductionDependencies) {
  const router = Router();
  const limit = createCollaborationRateLimit(60, 60_000);
  const admit: RequestHandler = async (req, res, next) => {
    res.set("Referrer-Policy", "no-referrer");
    if (production) await enforceShareLinkBudget(production, res, res.locals.ownerId);
    else {
      try { limit(res.locals.ownerId); }
      catch {
        res.set("Retry-After", "60");
        throw new HttpError(429, "SHARE_LINK_RATE_LIMIT", "Too many link requests. Try again shortly");
      }
    }
    if (!store) throw new HttpError(503, "SHARE_LINKS_UNSUPPORTED", "Link sharing is unavailable on this server");
    if (req.method !== "GET" && !req.is("application/json")) throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
    next();
  };
  router.get("/boards/:id/share-link", admit, async (req, res) => {
    res.json({ settings: await store!.get(boardIdSchema.parse(req.params.id).toLowerCase(), res.locals.ownerId) });
  });
  router.post("/boards/:id/share-link/copy", admit, async (req, res) => {
    res.json(await store!.copy(boardIdSchema.parse(req.params.id).toLowerCase(), res.locals.ownerId, copyShareLinkSchema.parse(req.body)));
  });
  router.patch("/boards/:id/share-link", admit, async (req, res) => {
    res.json(await store!.update(boardIdSchema.parse(req.params.id).toLowerCase(), res.locals.ownerId, updateShareLinkSchema.parse(req.body)));
  });
  router.post("/share-links/open", admit, async (req, res) => {
    res.json({ board: await store!.open(openShareLinkSchema.parse(req.body).token, res.locals.ownerId) });
  });
  return router;
}
