export type ProxyEnvironment = {
  PUBLIC_ORIGIN: string;
  API_ORIGIN: string;
  SCRIBBLE_PROXY_SECRET: string;
};

export function isApiPath(path: string) {
  return path === "/api" || path.startsWith("/api/") || path === "/health" || path === "/ready";
}

const noStore = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const failure = (status: number, code: string) => new Response(JSON.stringify({ error: { code, message: "API temporarily unavailable" } }), { status, headers: noStore });

/** Integrate before the existing Worker's static/site routing. Returning null
 * leaves every other application on the same domain with its current handler. */
export async function proxyApi(request: Request, env: ProxyEnvironment, transport: typeof fetch = fetch): Promise<Response | null> {
  const incoming = new URL(request.url);
  if (!isApiPath(incoming.pathname)) return null;
  let origin: URL;
  try {
    origin = new URL(env.API_ORIGIN);
    const publicOrigin = new URL(env.PUBLIC_ORIGIN);
    if (incoming.origin !== publicOrigin.origin || publicOrigin.protocol !== "https:" ||
        origin.protocol !== "https:" || origin.origin === publicOrigin.origin ||
        origin.hostname.endsWith(".invalid") || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
        env.SCRIBBLE_PROXY_SECRET.length < 32) throw new Error();
  } catch { return failure(503, "API_NOT_CONFIGURED"); }

  // Cloudflare supplies this header at its edge. Never accept a browser's
  // X-Scribble-Client-IP, proxy secret, or forwarding chain as that identity.
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (!clientIp || clientIp.length > 45 || !/^[a-fA-F0-9.:]+$/.test(clientIp)) return failure(400, "INVALID_EDGE_IDENTITY");
  const target = new URL(incoming.pathname + incoming.search, origin);
  const forwarded = new Request(target, request);
  for (const key of [...forwarded.headers.keys()]) {
    if (key.toLowerCase().startsWith("x-forwarded-") || key.toLowerCase().startsWith("x-scribble-proxy") ||
        ["forwarded", "host", "cf-connecting-ip", "x-scribble-client-ip"].includes(key.toLowerCase())) forwarded.headers.delete(key);
  }
  forwarded.headers.set("X-Scribble-Proxy-Secret", env.SCRIBBLE_PROXY_SECRET);
  forwarded.headers.set("X-Scribble-Client-IP", clientIp);
  // Prevent edge cache rules from caching private upstream responses too.
  forwarded.headers.set("Cache-Control", "no-store");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const upstream = await transport(forwarded, {
      redirect: "manual", signal: AbortSignal.any([request.signal, controller.signal]),
      cache: "no-cache", cf: { cacheTtlByStatus: { "100-599": -1 }, cacheEverything: false },
    } as RequestInit);
    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    // Forward redirects/cookies and stream binary uploads/SSE without buffering.
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  } catch { return failure(502, "API_UNAVAILABLE"); }
  finally { clearTimeout(timeout); }
}
