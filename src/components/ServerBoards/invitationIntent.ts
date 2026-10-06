const key = "scribble:pending-invitation";
const valid = (value: string | null) => value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;

// Tab-scoped navigation intent only; it never grants access or accepts an invite.
export function invitationIntent() {
  const linked = valid(new URLSearchParams(window.location.search).get("invite"));
  if (linked) return linked;
  try { return valid(sessionStorage.getItem(key)); } catch { return null; }
}
export function rememberInvitationIntent() {
  const id = invitationIntent();
  if (id) { try { sessionStorage.setItem(key, id); } catch { /* URL still carries intent until redirect. */ } }
}
export function clearInvitationIntent(id: string) {
  try { if (sessionStorage.getItem(key) === id) sessionStorage.removeItem(key); } catch { /* No durable access state here. */ }
  const url = new URL(window.location.href);
  if (url.searchParams.get("invite") === id) { url.searchParams.delete("invite"); window.history.replaceState(window.history.state, "", url); }
}
