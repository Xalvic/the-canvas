import { Router, type CookieOptions } from "express";
import { z } from "zod";
import {
  FLOW_COOKIE, FLOW_MAX_AGE, SESSION_COOKIE, SESSION_MAX_AGE,
  codeChallenge, googleIdentitySchema, hashToken, randomToken, readTokenCookie, tokenSchema,
  type AuthStore, type GoogleAuthProvider,
} from "./auth.js";
import { HttpError } from "./errors.js";
import { verifyMutationOrigin } from "./boardAccess.js";

export type AuthDependencies = {
  store: AuthStore;
  provider: GoogleAuthProvider | null;
  frontendUrl: string;
  secureCookies: boolean;
};
const callbackSchema = z.object({
  state: tokenSchema,
  code: z.string().min(1).max(4096).optional(),
  error: z.string().min(1).max(256).optional(),
}).refine((value) => Boolean(value.code) !== Boolean(value.error));

export function createAuthRouter(auth?: AuthDependencies) {
  const router = Router();
  const sessionCookie: CookieOptions = { httpOnly: true, sameSite: "lax", secure: auth?.secureCookies ?? false, path: "/api" };
  const flowCookie: CookieOptions = { ...sessionCookie, path: "/api/auth/google" };
  const starts = new Map<string, { count: number; until: number }>();

  router.get("/google", async (req, res) => {
    if (!auth?.provider) throw new HttpError(503, "GOOGLE_AUTH_NOT_CONFIGURED", "Google sign-in is not configured yet");
    const now = Date.now();
    for (const [key, value] of starts) if (value.until <= now) starts.delete(key);
    const ip = req.ip ?? "unknown";
    const attempts = starts.get(ip) ?? { count: 0, until: now + FLOW_MAX_AGE };
    if (attempts.count >= 20 || starts.size >= 1000 && !starts.has(ip)) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((attempts.until - now) / 1000))));
      throw new HttpError(429, "AUTH_RATE_LIMIT", "Too many sign-in attempts. Try again later");
    }
    attempts.count++;
    starts.set(ip, attempts);
    const state = randomToken(), browser = randomToken(), nonce = randomToken(), codeVerifier = randomToken();
    await auth.store.createFlow({ stateHash: hashToken(state), browserHash: hashToken(browser), nonce, codeVerifier });
    res.cookie(FLOW_COOKIE, browser, { ...flowCookie, maxAge: FLOW_MAX_AGE });
    res.redirect(auth.provider.authorizationUrl({ state, nonce, codeChallenge: codeChallenge(codeVerifier) }));
  });

  router.get("/google/callback", async (req, res) => {
    res.set("Referrer-Policy", "no-referrer");
    if (!auth?.provider) throw new HttpError(503, "GOOGLE_AUTH_NOT_CONFIGURED", "Google sign-in is not configured yet");
    function failure(reason: string) {
      const target = new URL(auth!.frontendUrl);
      target.searchParams.set("authError", reason);
      res.clearCookie(FLOW_COOKIE, flowCookie);
      res.redirect(303, target.href);
    }
    const query = callbackSchema.safeParse(req.query);
    const browser = readTokenCookie(req.headers.cookie, FLOW_COOKIE);
    if (!query.success || !browser) { failure("invalid_state"); return; }
    const flow = await auth.store.consumeFlow(hashToken(query.data.state), hashToken(browser));
    if (!flow) { failure("invalid_state"); return; }
    if (query.data.error) { failure(query.data.error === "access_denied" ? "denied" : "failed"); return; }
    let identity;
    try {
      identity = googleIdentitySchema.parse(await auth.provider.verifyCode(query.data.code!, flow));
    } catch {
      // Google errors may contain codes/tokens/client secrets. Never log them.
      failure("failed"); return;
    }
    const token = randomToken();
    const previous = readTokenCookie(req.headers.cookie, SESSION_COOKIE);
    const session = await auth.store.signIn(identity, hashToken(token), previous ? hashToken(previous) : undefined);
    res.clearCookie(FLOW_COOKIE, flowCookie);
    res.cookie(SESSION_COOKIE, token, { ...sessionCookie, maxAge: Math.min(SESSION_MAX_AGE, session.expiresAt - Date.now()) });
    res.redirect(303, auth.frontendUrl);
  });

  router.get("/me", async (req, res) => {
    const token = readTokenCookie(req.headers.cookie, SESSION_COOKIE);
    const session = token && auth ? await auth.store.getSession(hashToken(token)) : undefined;
    if (!session) {
      res.clearCookie(SESSION_COOKIE, sessionCookie);
      throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue", { googleSignInEnabled: Boolean(auth?.provider) });
    }
    res.json({ user: session.user });
  });

  router.post("/logout", async (req, res) => {
    // A required non-simple header + no CORS allowance prevents forged form logout.
    verifyMutationOrigin(req, auth);
    const token = readTokenCookie(req.headers.cookie, SESSION_COOKIE);
    if (token && auth) await auth.store.revokeSession(hashToken(token));
    res.clearCookie(SESSION_COOKIE, sessionCookie);
    res.clearCookie(FLOW_COOKIE, flowCookie);
    res.status(204).end();
  });
  return router;
}
