import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AccountState } from "../../api/auth";
import { invalidateAccountMetadata } from "../../api/accountBoardQueries";
import type { AccountBoardSession } from "../../persistence/accountBoardSession";
import type { WorkspaceController } from "../../persistence/workspaceController";
import { ShareLinkActions } from "../../persistence/shareLinkActions";
import { useBoardStore } from "../../store/boardStore";
import { Dialog } from "../Dialog";
import { BoardAccess } from "./Sharing";
import { useVisiblePolling } from "./useVisiblePolling";

export function ShareControls({ account, boardId, version, title, session, workspace, settingsOpen, closeSettings, feedbackSlot, autoCopy = false, pendingChanges = false }: {
  account: Extract<AccountState, { status: "signed-in" }>; boardId: string; version: number; title: string;
  session: AccountBoardSession; workspace: WorkspaceController; settingsOpen: boolean; closeSettings: () => void; autoCopy?: boolean; pendingChanges?: boolean;
  feedbackSlot: (element: HTMLElement | null) => void;
}) {
  const queryClient = useQueryClient();
  const visiblePolling = useVisiblePolling(settingsOpen);
  const [actions] = useState(() => new ShareLinkActions(boardId, account, workspace.prepareShare, () => {
    const board = useBoardStore.getState(), lifecycle = workspace.getState();
    return session.getState().userId === account.user.id && lifecycle.account?.status === "signed-in" && lifecycle.account.user.id === account.user.id &&
      lifecycle.status === "workspace" && lifecycle.phase === "ready" && !board.navigationPending &&
      board.account?.boardId === boardId && board.sessionVersion === version && board.accessRole === "owner";
  }, session.expire, () => { void invalidateAccountMetadata(queryClient, account.user.id); }));
  const state = useSyncExternalStore(actions.subscribe, actions.getState);
  const [accessOpen, setAccessOpen] = useState(false);
  useEffect(actions.start, [actions]);
  useEffect(() => { if (settingsOpen) void actions.load(); }, [settingsOpen, actions]);
  useEffect(() => {
    if (!visiblePolling) return;
    const refresh = () => {
      if (document.visibilityState !== "hidden" && navigator.onLine !== false) void actions.load(true);
    };
    refresh();
    const timer = setInterval(() => { void actions.load(true, true); }, visiblePolling);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [visiblePolling, actions]);
  useEffect(() => {
    if (!state.message || state.recoveredCopy) return;
    const timeout = setTimeout(actions.dismissMessage, 5000);
    return () => clearTimeout(timeout);
  }, [state.message, state.recoveredCopy, actions]);
  useEffect(() => {
    if (!autoCopy) return;
    const timeout = setTimeout(() => { void actions.copy(); workspace.sharedDestinationHandled(); }, 0);
    return () => clearTimeout(timeout);
  }, [autoCopy, actions, workspace]);
  const retry = () => state.pending ? actions.retry() : settingsOpen ? actions.load() : actions.copy();
  return <>
    <button className="ui-button primary-action header-save" type="button" disabled={state.busy} onClick={() => void (state.recoveredCopy && state.url ? actions.retryCopy() : actions.copy())}>{state.busy ? "Preparing link…" : "Share"}</button>
    {!settingsOpen && (!state.url || state.recoveredCopy) && (state.message || state.error) && <aside ref={feedbackSlot} className="share-feedback ui-status" data-tone={state.error ? "error" : "success"} aria-label="Link sharing" onKeyDown={(event) => event.stopPropagation()}>
      <span role={state.error ? "alert" : "status"}>{state.error ?? state.message}</span>
      {state.message && pendingChanges && <span>Your device changes will appear after syncing.</span>}
      {state.error && <button className="ui-button" type="button" disabled={state.busy} onClick={() => void retry()}>{state.pending ? "Retry link request" : "Retry Share"}</button>}
      {state.recoveredCopy && state.url && <>
        <button className="ui-button" type="button" disabled={state.busy} onClick={() => void actions.retryCopy()}>Copy link</button>
        <button className="ui-button" type="button" disabled={state.busy} onClick={actions.dismissCopy}>Dismiss</button>
      </>}
    </aside>}
    <Dialog open={settingsOpen || !!state.url && !state.recoveredCopy} title={settingsOpen ? "Link settings" : "Copy link"} close={() => { closeSettings(); if (state.url) actions.dismissCopy(); }}>
      <section className="board-sharing link-settings" aria-label="Link settings">
        <p>Anyone with this link must sign in with Google to open this page.</p>
        {pendingChanges && <p role="status">Your device changes will appear after syncing.</p>}
        {settingsOpen && <>
          {state.settings ? <>
            <p role="status">{state.settings.enabled ? "Link sharing is active." : "Link sharing is off."}</p>
            <label className="dialog-field">Link permission<select value={state.settings.role} disabled={state.busy || !!state.pending} onChange={(event) => void actions.role(event.target.value as "viewer" | "editor")}><option value="viewer">Can view</option><option value="editor">Can edit</option></select></label>
            <p className="dialog-footnote">This permission applies to everyone using the link. Can edit includes renaming; only you manage sharing or delete the page.</p>
            <div className="dialog-actions">
              <button className="ui-button primary-action" type="button" disabled={state.busy || !!state.pending} onClick={() => void actions.copy()}>{state.settings.enabled ? "Copy link" : "Enable and copy link"}</button>
              {state.settings.enabled && <button className="ui-button danger-action" type="button" disabled={state.busy || !!state.pending} onClick={() => void actions.stop()}>Stop sharing</button>}
            </div>
            <p className="dialog-footnote">Stopping the link removes access through it. Existing invited members keep their access. Sharing again creates a new link.</p>
          </> : state.busy && <p role="status">Checking link settings…</p>}
        </>}
        {state.busy && <p role="status">Preparing your link request…</p>}
        {state.message && <p role="status">{state.message}</p>}
        {state.error && <p role="alert">{state.error}</p>}
        {state.pending && !state.error && <p role="status">Checking your earlier link request before changing settings…</p>}
        {state.error && !state.url && <button className="ui-button" type="button" disabled={state.busy} onClick={() => void retry()}>{state.pending ? "Retry link request" : "Retry link settings"}</button>}
        {state.url && <>
          <label className="dialog-field">Shared page link<input readOnly value={state.url} onFocus={(event) => event.currentTarget.select()} /></label>
          <button className="ui-button primary-action" type="button" disabled={state.busy} onClick={() => void actions.retryCopy()}>{state.recoveredCopy ? "Copy link" : "Copy link again"}</button>
        </>}
        {settingsOpen && <details onToggle={(event) => setAccessOpen(event.currentTarget.open)}><summary>Existing invited access</summary>
          <p className="dialog-footnote">These members and invitations have separate access. Removing a member does not block them from using an active link again.</p>
          {accessOpen && <BoardAccess userId={account.user.id} boardId={boardId} title={title} session={session} />}
        </details>}
      </section>
    </Dialog>
  </>;
}
