import { describe, expect, it } from "vitest";
import { loadProductionConfig, requireVerifiedDatabaseTls } from "./productionConfig.js";

const settings = {
  DEPLOYMENT_ENV: "production", AUTH_FRONTEND_URL: "https://scribble.example/scribble/",
  GOOGLE_CLIENT_ID: "google-id", GOOGLE_CLIENT_SECRET: "google-secret",
  GOOGLE_REDIRECT_URI: "https://scribble.example/api/auth/google/callback",
  SCRIBBLE_PROXY_SECRET: "a".repeat(48), DATABASE_URL: "postgresql://user:private-password@db.example/scribble?sslmode=verify-full",
};
describe("production configuration", () => {
  it("keeps local containers in development unless production deployment is explicit", () => {
    expect(loadProductionConfig({ NODE_ENV: "production" })).toBeNull();
    expect(loadProductionConfig({ DEPLOYMENT_ENV: "development" })).toBeNull();
    expect(() => loadProductionConfig({ DEPLOYMENT_ENV: "prod" })).toThrow("DEPLOYMENT_ENV");
  });
  it("accepts complete same-origin HTTPS OAuth and verified database TLS", () => {
    expect(loadProductionConfig(settings)).toEqual({ proxySecret: settings.SCRIBBLE_PROXY_SECRET });
  });
  it.each([
    { AUTH_FRONTEND_URL: undefined }, { AUTH_FRONTEND_URL: "http://127.0.0.1:5173/scribble/", GOOGLE_REDIRECT_URI: "http://127.0.0.1:5173/api/auth/google/callback" },
    { GOOGLE_CLIENT_ID: undefined }, { GOOGLE_CLIENT_SECRET: undefined }, { GOOGLE_REDIRECT_URI: "https://scribble.example:8443/api/auth/google/callback" },
    { SCRIBBLE_PROXY_SECRET: "short" }, { SCRIBBLE_PROXY_SECRET: "a".repeat(257) }, { SCRIBBLE_PROXY_SECRET: "a".repeat(48) + "\n" },
    { DATABASE_URL: "postgresql://user:private-password@db.example/scribble" },
    { DATABASE_URL: "postgresql://user:private-password@db.example/scribble?sslmode=require" },
    { DATABASE_URL: "postgresql://user:private-password@db.example/scribble?sslmode=verify-full&sslmode=disable" },
    { DATABASE_URL: "postgresql://user:private-password@db.example/scribble?sslmode=verify-full&ssl=false" },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
  ])("fails closed without echoing secrets for %j", (override) => {
    try { loadProductionConfig({ ...settings, ...override }); throw new Error("accepted unsafe configuration"); }
    catch (error) {
      expect((error as Error).message).not.toBe("accepted unsafe configuration");
      expect((error as Error).message).not.toContain("private-password");
      expect((error as Error).message).not.toContain(settings.SCRIBBLE_PROXY_SECRET);
      expect((error as Error).message).not.toContain("google-secret");
    }
  });
  it("requires direct migration URLs to verify database certificates too", () => {
    expect(() => requireVerifiedDatabaseTls("postgresql://u:p@db.example/db?sslmode=disable", "Migration database URL")).toThrow("Migration database URL");
  });
});
