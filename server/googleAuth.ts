import { timingSafeEqual } from "node:crypto";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { googleIdentitySchema, type GoogleAuthProvider } from "./auth.js";
import type { GoogleAuthConfig } from "./authConfig.js";

export function createGoogleAuthProvider(config: GoogleAuthConfig): GoogleAuthProvider {
  // Each verification uses its own client; access tokens are never retained.
  function client() { return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri); }
  return {
    authorizationUrl({ state, nonce, codeChallenge }) {
      return client().generateAuthUrl({
        scope: ["openid", "email", "profile"], state, nonce,
        code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256,
        access_type: "online", prompt: "select_account",
      });
    },
    async verifyCode(code, { codeVerifier, nonce }) {
      const oauth = client();
      const { tokens } = await oauth.getToken({ code, codeVerifier, redirect_uri: config.redirectUri });
      if (!tokens.id_token) throw new Error("Missing Google identity token");
      // The library verifies signature, Google issuer, audience and expiration.
      const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
      const payload = ticket.getPayload();
      const receivedNonce = (payload as Record<string, unknown> | undefined)?.nonce;
      if (!payload || payload.email_verified !== true || typeof receivedNonce !== "string" ||
          Buffer.byteLength(receivedNonce) !== Buffer.byteLength(nonce) ||
          !timingSafeEqual(Buffer.from(receivedNonce), Buffer.from(nonce))) {
        throw new Error("Invalid Google identity claims");
      }
      return googleIdentitySchema.parse({ subject: payload.sub, email: payload.email, displayName: payload.name ?? null });
    },
  };
}
