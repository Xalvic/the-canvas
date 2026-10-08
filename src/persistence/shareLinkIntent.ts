const key = "scribble:pending-share-link";
const lifetime = 10 * 60_000;
const valid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

// Navigation only. The fragment/short-lived tab record never grants access.
export function shareLinkIntent(): string | null {
  const hash = new URL(window.location.href).hash;
  if (hash.startsWith("#share=")) return valid(hash.slice(7)) ? hash.slice(7) : null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const record: unknown = JSON.parse(raw);
    if (typeof record === "object" && record && "token" in record && "expiresAt" in record &&
        valid(record.token) && typeof record.expiresAt === "number" && record.expiresAt > Date.now() && record.expiresAt <= Date.now() + lifetime) return record.token;
    sessionStorage.removeItem(key);
  } catch { /* An original fragment can still be reopened after sign-in. */ }
  return null;
}

export function invalidShareLink() {
  const hash = new URL(window.location.href).hash;
  return hash.startsWith("#share=") && !valid(hash.slice(7));
}

export function rememberShareLinkIntent() {
  const token = shareLinkIntent();
  if (!token) return;
  try { sessionStorage.setItem(key, JSON.stringify({ token, expiresAt: Date.now() + lifetime })); }
  catch { throw new Error("This browser cannot remember the shared page through sign-in. Sign in in another tab, then reopen the original link here."); }
  const url = new URL(window.location.href);
  if (url.hash === `#share=${token}`) { url.hash = ""; window.history.replaceState(window.history.state, "", url); }
}

export function clearShareLinkIntent(token: string) {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw && JSON.parse(raw).token === token) sessionStorage.removeItem(key);
  } catch { /* The canonical URL still removes the secret. */ }
  const url = new URL(window.location.href);
  if (url.hash === `#share=${token}`) { url.hash = ""; window.history.replaceState(window.history.state, "", url); }
}

// Guest Share resumes only the explicitly consented transfer, never an arbitrary
// selected page. Bind it to the existing flow identity and its later destination.
const guestKey = "scribble:share-drawing-transfer";
export function rememberGuestShare(flowId: string) { sessionStorage.setItem(guestKey, flowId); }
export function guestShareMatches(flowId: string) {
  try { return sessionStorage.getItem(guestKey) === flowId; } catch { return false; }
}
export function clearGuestShare() { try { sessionStorage.removeItem(guestKey); } catch { /* Optional continuation only. */ } }
