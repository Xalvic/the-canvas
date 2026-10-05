import { proxyApi, type ProxyEnvironment } from "./api-proxy";

type Environment = ProxyEnvironment & { ASSETS: { fetch(request: Request): Promise<Response> } };

// A standalone example. The currently deployed personal-site Worker is outside
// this repository: integrate proxyApi into it instead of replacing its routing.
export default {
  async fetch(request: Request, env: Environment) {
    const proxied = await proxyApi(request, env);
    if (proxied) return proxied;
    const url = new URL(request.url);
    if (url.pathname === "/scribble") return Response.redirect(`${url.origin}/scribble/`, 308);
    if (!url.pathname.startsWith("/scribble/")) return new Response("Not found", { status: 404 });
    url.pathname = url.pathname.slice("/scribble".length);
    return env.ASSETS.fetch(new Request(url, request));
  },
};
