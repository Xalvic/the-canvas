import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "./authConfig.js";

const local = { GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "PRIVATE", GOOGLE_REDIRECT_URI: "http://127.0.0.1:3001/api/auth/google/callback" };
describe("Google auth configuration", () => {
  it("disables Google cleanly without credentials and accepts complete loopback/HTTPS configurations", () => {
    expect(loadAuthConfig({}).google).toBeNull();
    expect(loadAuthConfig(local).secureCookies).toBe(false);
    expect(loadAuthConfig({ ...local, GOOGLE_REDIRECT_URI: "https://scribble.example/api/auth/google/callback", AUTH_FRONTEND_URL: "https://scribble.example/scribble/" }).secureCookies).toBe(true);
  });
  it.each([
    { GOOGLE_CLIENT_ID: "only-one" },
    { ...local, GOOGLE_REDIRECT_URI: "http://127.0.0.1:3001/wrong" },
    { ...local, AUTH_FRONTEND_URL: "http://localhost:5173/scribble/" },
    { ...local, AUTH_FRONTEND_URL: "http://remote.example/" },
    { ...local, GOOGLE_REDIRECT_URI: "http://127.0.0.1:3001/api/auth/google/callback?redirect=evil" },
    { ...local, AUTH_FRONTEND_URL: "https://user:password@scribble.example/" },
  ])("rejects unsafe/partial configuration without exposing secrets", (env) => {
    expect(() => loadAuthConfig(env)).toThrow(/Set Google OAuth/);
    try { loadAuthConfig(env); } catch (error) { expect(String(error)).not.toContain("PRIVATE"); }
  });
});
