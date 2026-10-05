import { describe, expect, it, vi } from "vitest";
import { proxyApi } from "../deployment/cloudflare/api-proxy";

const env = { PUBLIC_ORIGIN: "https://milanputhukkudy.com", API_ORIGIN: "https://origin.example.com", SCRIBBLE_PROXY_SECRET: "s".repeat(48) };
const request = (path: string, init?: RequestInit) => new Request(env.PUBLIC_ORIGIN + path, { ...init, headers: { "CF-Connecting-IP": "203.0.113.8", ...init?.headers } });

describe("production same-origin Worker API proxy", () => {
  it("leaves site/static routing alone and refuses unconfigured or alternate public hosts", async () => {
    const fetcher = vi.fn();
    expect(await proxyApi(request("/scribble/"), env, fetcher)).toBeNull();
    expect((await proxyApi(request("/api/boards"), { ...env, API_ORIGIN: "https://not-set.invalid" }, fetcher))?.status).toBe(503);
    expect((await proxyApi(new Request("https://attacker.example/api/boards"), env, fetcher))?.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("forwards session cookies, CSRF and raw bodies while replacing spoofed origin identity", async () => {
    let captured: Request | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      captured = input as Request;
      expect(options?.redirect).toBe("manual");
      expect(await captured.text()).toBe('{"title":"Private board"}');
      return new Response("{}", { status: 201, headers: { "Cache-Control": "public, max-age=600" } });
    });
    const response = await proxyApi(request("/api/boards", { method: "POST", body: '{"title":"Private board"}', headers: {
      Cookie: "scribble_session=secret", Origin: env.PUBLIC_ORIGIN, "X-Scribble-Request": "1",
      "X-Scribble-Proxy-Secret": "forged", "X-Scribble-Client-IP": "127.0.0.1", "X-Forwarded-For": "forged",
    } }), env, fetcher);
    expect(response?.status).toBe(201);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(captured?.url).toBe("https://origin.example.com/api/boards");
    expect(captured?.headers.get("cookie")).toBe("scribble_session=secret");
    expect(captured?.headers.get("origin")).toBe(env.PUBLIC_ORIGIN);
    expect(captured?.headers.get("x-scribble-request")).toBe("1");
    expect(captured?.headers.get("x-scribble-proxy-secret")).toBe(env.SCRIBBLE_PROXY_SECRET);
    expect(captured?.headers.get("x-scribble-client-ip")).toBe("203.0.113.8");
    expect(captured?.headers.has("x-forwarded-for")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("returns Google redirects and cookie clearing to the browser without following them", async () => {
    const response = await proxyApi(request("/api/auth/google"), env, vi.fn(async () => new Response(null, { status: 302, headers: {
      Location: "https://accounts.google.com/o/oauth2/v2/auth", "Set-Cookie": "scribble_session=; HttpOnly; Secure; Max-Age=0",
    } })));
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toContain("accounts.google.com");
    expect(response?.headers.get("set-cookie")).toContain("HttpOnly; Secure");
  });
  it("streams a live SSE response before the upstream closes", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; value.enqueue(new TextEncoder().encode('event: revision\ndata: {"revision":2}\n\n')); } });
    const response = await proxyApi(request("/api/boards/id/events?clientId=id"), env, vi.fn(async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } })));
    const reader = response!.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"revision":2');
    controller.close();
    expect((await reader.read()).done).toBe(true);
  });
  it("fails closed on missing edge identity and never retries a failed mutation", async () => {
    const fetcher = vi.fn(async () => { throw new Error("secret internal connection URL"); });
    expect((await proxyApi(new Request(env.PUBLIC_ORIGIN + "/api/boards"), env, fetcher))?.status).toBe(400);
    const response = await proxyApi(request("/api/boards", { method: "POST", body: "{}" }), env, fetcher);
    expect(response?.status).toBe(502);
    expect(await response?.text()).not.toContain("secret internal");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
