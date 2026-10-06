import { useEffect, useRef, useState } from "react";
import { Dialog } from "../Dialog";
import { rememberInvitationIntent } from "../ServerBoards/invitationIntent";
import { HelpDialog } from "../HelpDialog";
import { useThemeStore } from "../../store/themeStore";
import { waitForLocalBoardSave } from "../../persistence/waitForLocalBoardSave";
import { rememberPageIntent } from "../../persistence/workspaceNavigation";
import type { WorkspaceController, WorkspaceState } from "../../persistence/workspaceController";

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

export function Account({ workspace, lifecycle, openRequest = 0 }: {
  workspace: WorkspaceController;
  lifecycle: WorkspaceState;
  openRequest?: number;
}) {
  const state = lifecycle.account ?? (lifecycle.status === "auth-loading" ? { status: "loading" as const } :
    lifecycle.status === "expired" ? { status: "guest" as const, googleSignInEnabled: true } : { status: "error" as const });
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const theme = useThemeStore((store) => store.preference);
  const setTheme = useThemeStore((store) => store.setPreference);
  const [busy, setBusy] = useState(false);
  const loginRequest = useRef<AbortController | null>(null);
  useEffect(() => { if (openRequest > 0) setOpen(true); }, [openRequest]);

  useEffect(() => {
    const message = callbackError();
    if (message) { setError(message); setOpen(true); }
    return () => { loginRequest.current?.abort(); };
  }, []);

  async function login() {
    if (busy) return;
    const controller = new AbortController();
    loginRequest.current = controller;
    setBusy(true); setError(null);
    try {
      await waitForLocalBoardSave(controller.signal);
      if (!controller.signal.aborted) { rememberInvitationIntent(); rememberPageIntent(); window.location.assign("/api/auth/google"); }
    } catch {
      if (!controller.signal.aborted) { setError("Couldn’t save your canvas before sign-in. Please try again."); setBusy(false); }
    }
  }

  async function logout() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await workspace.logout();
    } finally { setBusy(false); }
  }

  return (
    <>
    <button type="button" className="account-trigger" aria-label={state.status === "error" ? "Account unavailable — retry" : undefined} aria-haspopup="dialog" onClick={() => setOpen(true)}>{state.status === "signed-in" ? "Account" : state.status === "loading" ? "Connecting…" : state.status === "error" ? "Account ⚠" : "Sign in"}</button>
    <Dialog open={open} title="Your account" close={() => setOpen(false)}>
    <section className="account" aria-label="Your account">
      {state.status === "loading" && <p role="status">Connecting to your account…</p>}
      {state.status === "error" && <>
        {!lifecycle.error && <p role="alert">Couldn’t check sign-in. Your canvas is still available.</p>}
        <button className="server-boards-refresh" type="button" onClick={() => void workspace.checkAccount()}>Retry sign-in check</button>
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
      {lifecycle.error && <p className="server-boards-error" role="alert">{lifecycle.error}</p>}
      <div className="dialog-actions" role="group" aria-label="Account color theme"><button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>Light</button><button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>Dark</button></div>
      <button type="button" onClick={() => setHelpOpen(true)}>Help and shortcuts</button>
      <HelpDialog open={helpOpen} close={() => setHelpOpen(false)} />
    </section>
    </Dialog>
    </>
  );
}
