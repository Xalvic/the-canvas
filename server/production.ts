import { randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { RequestHandler } from "express";
import { HttpError } from "./errors.js";
import type { BudgetStore } from "./productionBudgets.js";

export type ProductionDependencies = {
  proxySecret: string;
  budgets: BudgetStore;
  ready: () => Promise<void>;
  log?: (record: Record<string, unknown>) => void;
};

function routeClass(path: string) {
  if (/^\/api\/auth\/google\/callback\/?$/.test(path)) return "auth-callback";
  if (/^\/api\/auth\/google\/?$/.test(path)) return "auth-start";
  if (/^\/api\/auth(?:\/|$)/.test(path)) return "auth-session";
  if (/^\/api\/boards(?:\/|$)/.test(path)) return "boards";
  if (/^\/api\/invitations(?:\/|$)/.test(path)) return "invitations";
  return "unknown";
}

export function verifyProductionOrigin(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], secret: string) {
  const expected = Buffer.from(secret);
  const actual = Buffer.from(req.get("X-Scribble-Proxy-Secret") ?? "");
  const clientIp = req.get("X-Scribble-Client-IP");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || !clientIp || !isIP(clientIp)) {
    throw new HttpError(403, "PROXY_REQUIRED", "Request must use the configured application origin");
  }
  res.locals.productionClientIp = clientIp;
}

export function productionRequestGuard(deps: ProductionDependencies): RequestHandler {
  return async (req, res, next) => {
    const requestId = randomUUID();
    const start = performance.now();
    const category = routeClass(req.originalUrl.split("?")[0]!.toLowerCase());
    res.set("X-Request-Id", requestId);
    res.on("finish", () => {
      (deps.log ?? ((record) => console.log(JSON.stringify(record))))({ event: "request", requestId,
        method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(req.method) ? req.method : "OTHER",
        route: category, status: res.statusCode, durationMs: Math.round(performance.now() - start) });
    });
    verifyProductionOrigin(req, res, deps.proxySecret);
    const clientIp = res.locals.productionClientIp as string;
    // Only the authenticated edge's overwritten IP header is used. Express
    // forwarded headers and caller-supplied request IDs remain untrusted.
    await enforceBudget(deps.budgets, res, "api-ip", clientIp, 2400, 60);
    if (category === "auth-start") await enforceBudget(deps.budgets, res, "auth-start", clientIp, 20, 600);
    if (category === "auth-callback") await enforceBudget(deps.budgets, res, "auth-callback", clientIp, 40, 600);
    next();
  };
}

async function enforceBudget(budgets: BudgetStore, res: Parameters<RequestHandler>[1], scope: string, identity: string, limit: number, seconds: number) {
  let result;
  try { result = await budgets.consume(scope, identity, limit, seconds); }
  catch { throw new HttpError(503, "ADMISSION_UNAVAILABLE", "Request admission is temporarily unavailable"); }
  if (!result.allowed) {
    res.set("Retry-After", String(result.retryAfter));
    throw new HttpError(429, "REQUEST_RATE_LIMIT", "Too many requests. Try again later");
  }
}

export function productionUserBudget(deps: ProductionDependencies): RequestHandler {
  return async (req, res, next) => {
    const read = ["GET", "HEAD", "OPTIONS"].includes(req.method);
    await enforceUserBudget(deps, res, res.locals.ownerId as string, read);
    next();
  };
}

export async function enforceUserBudget(deps: ProductionDependencies, res: Parameters<RequestHandler>[1], userId: string, read: boolean) {
  await enforceBudget(deps.budgets, res, read ? "user-read" : "user-write", userId, read ? 1200 : 900, 60);
}

export async function checkReady(ready: () => Promise<void>, timeoutMs = 2000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.resolve().then(ready), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Readiness deadline")), timeoutMs);
      timer.unref();
    })]);
  } finally { clearTimeout(timer); }
}
