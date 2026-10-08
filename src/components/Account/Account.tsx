import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "../Dialog";
import { rememberInvitationIntent } from "../ServerBoards/invitationIntent";
import { Menu } from "../Menu";
import { loadLocalBoard } from "../../persistence/localBoardStorage";
import { useDocumentStore } from "../../store/documentStore";
import { useBoardStore } from "../../store/boardStore";
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

export function Account({ workspace, lifecycle, openRequest = 0, shareDrawingRequest = 0, triggerTarget, inSidebar = false }: {
  workspace: WorkspaceController;
  lifecycle: WorkspaceState;
  openRequest?: number;
  shareDrawingRequest?: number;
  triggerTarget: HTMLElement | null;
  inSidebar?: boolean;
}) {
  const state = lifecycle.account ?? (lifecycle.status === "auth-loading" ? { status: "loading" as const } :
    lifecycle.status === "expired" ? { status: "guest" as const, googleSignInEnabled: true } : { status: "error" as const });
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bringDrawing, setBringDrawing] = useState(false);
  const [shareDrawing, setShareDrawing] = useState(false);
  const openingShared = lifecycle.sharedPage === "sign-in" && !shareDrawing;
  const [retainedDrawing, setRetainedDrawing] = useState(false);
  const objects = useDocumentStore((store) => store.objects);
  const activeAccount = useBoardStore((store) => store.account);
  const hasDrawing = !activeAccount && Object.keys(objects).length > 0 || retainedDrawing;
  const loginRequest = useRef<AbortController | null>(null);
  useEffect(() => { if (openRequest > 0) setOpen(true); }, [openRequest]);
  useEffect(() => { if (shareDrawingRequest > 0) { setShareDrawing(true); setBringDrawing(false); setOpen(true); } }, [shareDrawingRequest]);
  useEffect(() => {
    if (!open) { setBringDrawing(false); return; }
    let current = true;
    if (state.status === "signed-in") void loadLocalBoard().then((board) => {
      if (current) setRetainedDrawing(!!board && Object.keys(board.objects).length > 0);
    }).catch(() => { if (current) setRetainedDrawing(false); });
    else setRetainedDrawing(false);
    return () => { current = false; };
  }, [open, state.status]);

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
      const target = await workspace.prepareGoogleSignIn(!openingShared && hasDrawing && bringDrawing, controller.signal, shareDrawing);
      if (!controller.signal.aborted) { rememberInvitationIntent(); rememberPageIntent(); window.location.assign(target); }
    } catch (error) {
      if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : "Couldn’t save your canvas before sign-in. Please try again."); setBusy(false); setOpen(true); }
    } finally { if (loginRequest.current === controller) loginRequest.current = null; }
  }

  function closeAccount() {
    if (loginRequest.current) { loginRequest.current.abort(); loginRequest.current = null; setBusy(false); }
    setOpen(false);
    setShareDrawing(false);
  }

  async function logout() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await workspace.logout();
    } finally { setBusy(false); }
  }

  const trigger = <div className="account-control" onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
    {state.status === "signed-in" ? <Menu label="Account menu" className="account-menu" triggerClass={`account-trigger ${inSidebar ? "sidebar-account-trigger" : "avatar-trigger"}`} trigger={<>
      <span className="account-avatar" aria-hidden="true">{(state.user.displayName ?? state.user.email).slice(0, 1).toUpperCase()}</span>
      {inSidebar && <span className="account-name" title={state.user.displayName ?? state.user.email}>{state.user.displayName ?? state.user.email}</span>}
    </>}>
      <strong>{state.user.displayName ?? state.user.email}</strong><span className="menu-email">{state.user.email}</span>
      <button type="button" role="menuitem" onClick={() => setOpen(true)}>{lifecycle.transfer ? "Resume drawing transfer" : "Your account and retained drawing"}</button>
      <button type="button" role="menuitem" disabled={busy} onClick={() => void logout()}>{busy ? "Signing out…" : "Sign out"}</button>
    </Menu> : <button type="button" className="ui-button account-trigger" aria-label={state.status === "error" ? "Account unavailable — retry" : state.status === "guest" && !busy ? "Sign in with Google" : undefined} aria-haspopup={hasDrawing || state.status !== "guest" ? "dialog" : undefined} disabled={busy}
      onClick={() => { if (state.status === "guest" && state.googleSignInEnabled && !hasDrawing) void login(); else setOpen(true); }}>{state.status === "loading" ? "Connecting…" : state.status === "error" ? "Account ⚠" : busy ? "Connecting…" : <><span className="account-sign-in-full">Sign in with Google</span><span className="account-sign-in-short" aria-hidden="true">Sign in</span></>}</button>}
  </div>;

  return (
    <>
    {triggerTarget && createPortal(trigger, triggerTarget)}
    <Dialog open={open} title={shareDrawing ? "Share this drawing" : openingShared ? "Open shared page" : "Your account"} close={closeAccount}>
    <section className="account" aria-label="Your account">
      {state.status === "loading" && <p role="status">Connecting to your account…</p>}
      {state.status === "error" && <>
        {!lifecycle.error && <p role="alert">Couldn’t check sign-in. Your canvas is still available.</p>}
        <button className="server-boards-refresh" type="button" onClick={() => void workspace.checkAccount()}>Retry sign-in check</button>
      </>}
      {state.status === "guest" && <>
        <p>{shareDrawing ? "Sharing requires Google sign-in and saving this drawing to your account." : openingShared ? "Sign in with Google to open this page. Your device drawing stays here." : "Keep drawing as a guest, or sign in with Google."}</p>
        {hasDrawing && !openingShared && <><label className="transfer-choice"><input type="checkbox" checked={bringDrawing} disabled={busy} onChange={(event) => setBringDrawing(event.target.checked)} />Bring this drawing into my workspace</label><p className="dialog-footnote">Includes its images. Your original drawing stays on this device. Leave this unchecked to keep it here.</p></>}
        {shareDrawing && !hasDrawing && <p>Add something to your drawing before sharing it.</p>}
        {state.googleSignInEnabled ? <a className="account-google" href="/api/auth/google" aria-disabled={busy || shareDrawing && (!bringDrawing || !hasDrawing)} onClick={(event) => { event.preventDefault(); if (!busy && (!shareDrawing || bringDrawing && hasDrawing)) void login(); }}>{busy ? "Saving canvas…" : "Sign in with Google"}</a> :
          <p className="server-boards-description">Google sign-in isn’t available right now.</p>}
      </>}
      {state.status === "signed-in" && <>
        <p className="account-email">{state.user.displayName ?? state.user.email}<br />{state.user.displayName && state.user.email}</p>
        {lifecycle.transfer ? <>
          <p>Your drawing transfer is {lifecycle.transfer.status === "paused" ? "paused" : "ready to continue"}. Its original is preserved on this device.</p>
          <button type="button" disabled={busy || !!lifecycle.transferProgress} onClick={() => { setOpen(false); void workspace.resumeTransfer(); }}>Resume drawing transfer</button>
        </> : hasDrawing && <>
          <label className="transfer-choice"><input type="checkbox" checked={bringDrawing} disabled={busy} onChange={(event) => setBringDrawing(event.target.checked)} />Bring this drawing into my workspace</label>
          <p className="dialog-footnote">Bring the retained device drawing and its images into a new page. Your original stays here.</p>
          <button type="button" disabled={!bringDrawing || busy} onClick={() => { setOpen(false); void workspace.bringGuestDrawing(shareDrawing); setShareDrawing(false); }}>{shareDrawing ? "Save drawing and share" : "Bring drawing"}</button>
        </>}
        <button className="server-boards-refresh" type="button" disabled={busy} onClick={() => void logout()}>{busy ? "Signing out…" : "Sign out"}</button>
      </>}
      {error && <p className="server-boards-error" role="alert">{error}</p>}
      {lifecycle.error && <p className="server-boards-error" role="alert">{lifecycle.error}</p>}
    </section>
    </Dialog>
    </>
  );
}
