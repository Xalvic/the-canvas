import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const SESSION_COOKIE = "scribble_session";
export const FLOW_COOKIE = "scribble_google_flow";
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export const FLOW_MAX_AGE = 10 * 60 * 1000;
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const profileString = z.string().refine((value) => !value.includes("\0") && !/[\uD800-\uDFFF]/u.test(value));
export const googleIdentitySchema = z.object({
  subject: z.string().regex(/^[\x21-\x7e]{1,255}$/),
  email: profileString.pipe(z.email().max(254)),
  displayName: profileString.max(200).nullable(),
});
export type GoogleIdentity = z.output<typeof googleIdentitySchema>;
export type AuthUser = { id: string; email: string; displayName: string | null };
export type GoogleFlow = { stateHash: string; browserHash: string; nonce: string; codeVerifier: string };
export type AuthSession = { user: AuthUser; expiresAt: number };

export interface AuthStore {
  createFlow(flow: GoogleFlow): Promise<void>;
  consumeFlow(stateHash: string, browserHash: string): Promise<{ nonce: string; codeVerifier: string } | undefined>;
  signIn(identity: GoogleIdentity, tokenHash: string, previousTokenHash?: string): Promise<AuthSession>;
  getSession(tokenHash: string): Promise<AuthSession | undefined>;
  revokeSession(tokenHash: string): Promise<void>;
}
export interface GoogleAuthProvider {
  authorizationUrl(flow: { state: string; nonce: string; codeChallenge: string }): string;
  verifyCode(code: string, flow: { nonce: string; codeVerifier: string }): Promise<GoogleIdentity>;
}
export function randomToken() { return randomBytes(32).toString("base64url"); }
export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function codeChallenge(verifier: string) { return createHash("sha256").update(verifier).digest("base64url"); }

// Tokens use only cookie-safe characters; ambiguous/malformed cookies are ignored.
export function readTokenCookie(cookie: string | undefined, name: string): string | undefined {
  const values = cookie?.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`)) ?? [];
  if (values.length !== 1) return undefined;
  const value = values[0].slice(name.length + 1);
  return tokenSchema.safeParse(value).success ? value : undefined;
}
