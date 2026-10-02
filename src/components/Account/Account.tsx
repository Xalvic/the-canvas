import { useEffect, useRef, useState } from "react";
import { getAccount, signOut, type AccountState } from "../../api/auth";
import { waitForLocalBoardSave } from "../../persistence/waitForLocalBoardSave";

const callbackMessages: Record<string, string> = {
  denied: "Google sign-in was cancelled. You can keep using your canvas.",
  invalid_state: "That sign-in link expired. Please try again.",
  failed: "Google sign-in didn’t finish. Please try again.",
};

function callbackError() {
  const url = new URL(window.location.href);
  const error = url.searchParams.get("authError");
  if (!error) return null;
  url.searchParams.delete("authError");
  window.history.replaceState(window.history.state, "", url.href);
  return callbackMessages[error] ?? callbackMessages.failed;
}

export function Account() {
  const [state, setState] = useState<AccountState | { status: "loading" } | { status: "error" }>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const logoutRequest = useRef<AbortController | null>(null);
  const loginRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const message = callbackError();
    if (message) setError(message);
    return () => { logoutRequest.current?.abort(); loginRequest.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    getAccount(controller.signal).then((account) => {
      if (!controller.signal.aborted) setState(account);
    }).catch(() => { if (!controller.signal.aborted) setState({ status: "error" }); });
    return () => controller.abort();
  }, [version]);

  async function login() {
    if (busy) return;
    const controller = new AbortController();
    loginRequest.current = controller;
    setBusy(true); setError(null);
    try {
      await waitForLocalBoardSave(controller.signal);
      if (!controller.signal.aborted) window.location.assign("/api/auth/google");
    } catch {
      if (!controller.signal.aborted) { setError("Couldn’t save your canvas before sign-in. Please try again."); setBusy(false); }
    }
  }

  async function logout() {
    if (busy) return;
    const controller = new AbortController();
    logoutRequest.current = controller;
    setBusy(true); setError(null);
    try {
      await signOut(controller.signal);
      if (!controller.signal.aborted) { setState({ status: "loading" }); setVersion((value) => value + 1); }
    } catch {
      if (!controller.signal.aborted) setError("Couldn’t sign out. Please try again.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return (
    <section className="account" aria-label="Your account" onKeyDown={(event) => event.stopPropagation()}>
      <h2>Your account</h2>
      {state.status === "loading" && <p role="status">Checking sign-in…</p>}
      {state.status === "error" && <>
        <p role="alert">Couldn’t check sign-in. Your canvas is still available.</p>
        <button className="server-boards-refresh" type="button" onClick={() => { setState({ status: "loading" }); setVersion((value) => value + 1); }}>Retry sign-in check</button>
      </>}
      {state.status === "guest" && <>
        <p>Keep drawing as a guest, or sign in with Google.</p>
        {state.googleSignInEnabled ? <a className="account-google" href="/api/auth/google" aria-disabled={busy} onClick={(event) => { event.preventDefault(); void login(); }}>{busy ? "Saving canvas…" : "Sign in with Google"}</a> :
          <p className="server-boards-description">Google sign-in isn’t available right now.</p>}
      </>}
      {state.status === "signed-in" && <>
        <p className="account-email">{state.user.displayName ?? state.user.email}<br />{state.user.displayName && state.user.email}</p>
        <button className="server-boards-refresh" type="button" disabled={busy} onClick={() => void logout()}>{busy ? "Signing out…" : "Sign out"}</button>
      </>}
      {error && <p className="server-boards-error" role="alert">{error}</p>}
    </section>
  );
}
