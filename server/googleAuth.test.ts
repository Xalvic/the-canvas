import { generateKeyPairSync, sign } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGoogleAuthProvider } from "./googleAuth.js";
import { codeChallenge, randomToken } from "./auth.js";

const config = { clientId: "unit.apps.googleusercontent.com", clientSecret: "test-secret", redirectUri: "http://127.0.0.1:3001/api/auth/google/callback" };
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const verifier = randomToken(), nonce = randomToken();
const claims = () => ({ iss: "https://accounts.google.com", aud: config.clientId, sub: "google-subject", email: "user@example.com", email_verified: true, name: "Artist", nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
function token(payload: object, corruptSignature = false) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "unit-key" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const message = `${header}.${body}`;
  const signature = sign("RSA-SHA256", Buffer.from(message), keys.privateKey);
  if (corruptSignature) signature[0] ^= 1;
  return `${message}.${signature.toString("base64url")}`;
}
function networkFixtures(jwt: string) {
  const exchange = vi.spyOn(OAuth2Client.prototype, "getToken").mockResolvedValue({ tokens: { id_token: jwt }, res: null } as never);
  // Stub Google network I/O only; signature/issuer/audience/expiry checks run for real.
  vi.spyOn(OAuth2Client.prototype, "getFederatedSignonCertsAsync").mockResolvedValue({ certs: { "unit-key": keys.publicKey.export({ type: "spki", format: "pem" }) }, format: "PEM" } as never);
  return exchange;
}
afterEach(() => vi.restoreAllMocks());

describe("Google identity verification boundary", () => {
  it("requests only sign-in scopes with S256 PKCE, state and nonce", () => {
    const url = new URL(createGoogleAuthProvider(config).authorizationUrl({ state: "state", nonce, codeChallenge: codeChallenge(verifier) }));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(codeChallenge(verifier));
    expect(url.searchParams.get("nonce")).toBe(nonce);
    expect(url.searchParams.get("access_type")).toBe("online");
    expect(url.href).not.toContain(config.clientSecret);
  });

  it("exchanges the code with its verifier and accepts only a verified minimal identity", async () => {
    const exchange = networkFixtures(token(claims()));
    const provider = createGoogleAuthProvider(config);
    expect(await provider.verifyCode("authorization-code", { nonce, codeVerifier: verifier })).toEqual({ subject: "google-subject", email: "user@example.com", displayName: "Artist" });
    expect(exchange).toHaveBeenCalledExactlyOnceWith({ code: "authorization-code", codeVerifier: verifier, redirect_uri: config.redirectUri });
  });

  it.each([
    { aud: "another-client" }, { iss: "https://evil.example" },
    { exp: Math.floor(Date.now() / 1000) - 600 },
    { nonce: "different-nonce" }, { nonce: undefined }, { email_verified: false },
    { sub: "" }, { email: "not-email" }, { name: "bad\0profile" },
  ])("rejects signed tokens with invalid claims %j", async (changes) => {
    networkFixtures(token({ ...claims(), ...changes }));
    await expect(createGoogleAuthProvider(config).verifyCode("code", { nonce, codeVerifier: verifier })).rejects.toThrow();
  });

  it("rejects a corrupt signature rather than trusting decoded claims", async () => {
    networkFixtures(token(claims(), true));
    await expect(createGoogleAuthProvider(config).verifyCode("code", { nonce, codeVerifier: verifier })).rejects.toThrow();
  });
});
