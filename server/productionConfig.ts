import { loadAuthConfig } from "./authConfig.js";
import { loadDatabaseUrl } from "./database.js";

export type ProductionConfig = { proxySecret: string };

export function requireVerifiedDatabaseTls(value: string, label = "DATABASE_URL") {
  const url = new URL(value);
  if (url.searchParams.getAll("sslmode").length !== 1 || url.searchParams.get("sslmode") !== "verify-full" ||
      url.searchParams.has("ssl")) {
    throw new Error(`${label} must use sslmode=verify-full with certificate verification enabled`);
  }
}

export function loadProductionConfig(env: NodeJS.ProcessEnv = process.env): ProductionConfig | null {
  if (!env.DEPLOYMENT_ENV || env.DEPLOYMENT_ENV === "development") return null;
  if (env.DEPLOYMENT_ENV !== "production") throw new Error("DEPLOYMENT_ENV must be development or production");
  const auth = loadAuthConfig(env);
  if (!env.AUTH_FRONTEND_URL || !auth.google || !auth.secureCookies ||
      new URL(auth.google.redirectUri).origin !== new URL(auth.frontendUrl).origin) {
    throw new Error("Production requires HTTPS AUTH_FRONTEND_URL and complete same-origin Google OAuth settings");
  }
  const proxySecret = env.SCRIBBLE_PROXY_SECRET;
  if (!proxySecret || Buffer.byteLength(proxySecret) < 32 || Buffer.byteLength(proxySecret) > 256 || /[\s\r\n]/.test(proxySecret)) {
    throw new Error("Production requires a 32–256 byte SCRIBBLE_PROXY_SECRET without whitespace");
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("Production TLS certificate verification must remain enabled");
  requireVerifiedDatabaseTls(loadDatabaseUrl(env));
  return { proxySecret };
}
