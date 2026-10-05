import type { Request, RequestHandler } from "express";
import { SESSION_COOKIE, hashToken, readTokenCookie } from "./auth.js";
import type { AuthDependencies } from "./authRoutes.js";
import { HttpError } from "./errors.js";

export function verifyMutationOrigin(req: Request, auth?: AuthDependencies) {
  const origin = req.get("Origin");
  if (req.get("X-Scribble-Request") !== "1" ||
      origin && (!auth || origin !== new URL(auth.frontendUrl).origin) ||
      req.get("Sec-Fetch-Site") === "cross-site") {
    throw new HttpError(403, "CSRF_REJECTED", "Request origin could not be verified");
  }
}

export function requireBoardSession(auth?: AuthDependencies): RequestHandler {
  return async (req, res, next) => {
    const token = readTokenCookie(req.headers.cookie, SESSION_COOKIE);
    const session = token && auth ? await auth.store.getSession(hashToken(token)) : undefined;
    if (!session || session.expiresAt <= Date.now()) {
      throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue");
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) verifyMutationOrigin(req, auth);
    res.locals.ownerId = session.user.id;
    res.locals.userEmail = session.user.email;
    next();
  };
}
