export type GoogleAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type AuthConfig = { google: GoogleAuthConfig | null; frontendUrl: string; secureCookies: boolean };

function localHttpOrHttps(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) {
    throw new Error();
  }
  return url;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  try {
    const frontend = localHttpOrHttps(env.AUTH_FRONTEND_URL ?? "http://127.0.0.1:5173/scribble/");
    const values = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI];
    if (values.every((value) => !value)) return { google: null, frontendUrl: frontend.href, secureCookies: frontend.protocol === "https:" };
    if (values.some((value) => !value?.trim())) throw new Error();
    const redirect = localHttpOrHttps(env.GOOGLE_REDIRECT_URI!);
    if (redirect.pathname !== "/api/auth/google/callback" || redirect.hostname !== frontend.hostname || redirect.protocol !== frontend.protocol) throw new Error();
    return {
      google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET!, redirectUri: redirect.href },
      frontendUrl: frontend.href,
      secureCookies: frontend.protocol === "https:",
    };
  } catch {
    // Configuration errors must never echo client secrets or connection details.
    throw new Error("Set Google OAuth credentials, an /api/auth/google/callback redirect, and AUTH_FRONTEND_URL using the same host/protocol; use HTTPS except on loopback");
  }
}
