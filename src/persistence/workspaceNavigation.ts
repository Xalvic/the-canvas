import { z } from "zod";
import type { InitializeServerWorkspaceInput } from "../api/workspace";

const uuid = z.uuid();
const pendingPageKey = "scribble:pending-page";
const initializationKey = (userId: string) => `scribble:workspace-initialization:${userId}`;
const initializationSchema = z.strictObject({ requestId: uuid, createInitialPage: z.boolean() });

export function pageFromUrl() {
  const value = new URL(window.location.href).searchParams.get("page");
  return uuid.safeParse(value).success ? value!.toLowerCase() : null;
}

// A deliberate Google redirect can drop the query; retain just this tab's target.
export function rememberPageIntent() {
  const pageId = pageFromUrl();
  if (pageId) sessionStorage.setItem(pendingPageKey, pageId);
  else sessionStorage.removeItem(pendingPageKey);
}

export function pendingPageIntent() {
  try {
    const value = sessionStorage.getItem(pendingPageKey);
    return uuid.safeParse(value).success ? value!.toLowerCase() : null;
  } catch { return null; }
}
export function clearPageIntent() { try { sessionStorage.removeItem(pendingPageKey); } catch { /* URL remains authoritative. */ } }

export function writePageUrl(pageId: string | null, mode: "push" | "replace") {
  const url = new URL(window.location.href);
  if (pageId) url.searchParams.set("page", pageId);
  else url.searchParams.delete("page");
  if (url.href !== window.location.href) window.history[mode === "push" ? "pushState" : "replaceState"](window.history.state, "", url);
}

// Write before dispatch. Uncertain initialization always reuses the original mode
// and UUID, including after reload; never silently fall back to legacy creation.
export function workspaceInitializationIntent(userId: string, createInitialPage: boolean): InitializeServerWorkspaceInput {
  const key = initializationKey(userId);
  const stored = localStorage.getItem(key);
  if (stored !== null) return initializationSchema.parse(JSON.parse(stored));
  const intent = { requestId: crypto.randomUUID(), createInitialPage };
  localStorage.setItem(key, JSON.stringify(intent));
  return intent;
}
export function clearWorkspaceInitializationIntent(userId: string) { localStorage.removeItem(initializationKey(userId)); }
