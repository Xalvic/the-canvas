import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { BoardSignInRequired } from "../../api/boards";
import { accountBoardListOptions } from "../../api/accountBoardQueries";
import { Account } from "../Account/Account";
import { useAccountBoardSession } from "../../persistence/accountBoardSession";
import { useBoardStore } from "../../store/boardStore";
import { useUiStore } from "../../store/uiStore";
import { BoardSharing, InvitationInbox } from "./Sharing";

export function ServerBoards() {
  const { session, state: accountBoards } = useAccountBoardSession();
  const userId = accountBoards.userId;
  const boards = useQuery({ ...accountBoardListOptions(userId ?? ""), enabled: !!userId });
  const activeAccount = useBoardStore((board) => board.account);
  const accessRole = useBoardStore((board) => board.accessRole);
  const readOnly = useBoardStore((board) => board.readOnly);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const isHydrated = useBoardStore((board) => board.isHydrated);
  const localSaveStatus = useBoardStore((board) => board.saveStatus);
  const localSaveError = useBoardStore((board) => board.saveError);
  const panel = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => useUiStore.subscribe((next, previous) => {
    if (next.activeTool !== previous.activeTool && window.matchMedia("(max-width: 767px)").matches && panel.current) {
      panel.current.open = false;
    }
  }), []);
  const accountChanged = useCallback((id: string | null) => {
    session.setUser(id);
  }, [session]);

  useEffect(() => {
    if (userId && boards.error instanceof BoardSignInRequired) session.expire();
  }, [boards.error, userId, session]);

  useEffect(() => { setSharingId(null); }, [userId]);
  useEffect(() => {
    if (!userId || !activeAccount) return;
    void session.refreshAccess();
    const refresh = () => void session.refreshAccess();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [userId, activeAccount?.boardId, session]);

  return (
    <details
      ref={panel}
      className="server-boards"
      open
      onKeyDown={(event) => event.stopPropagation()}
    >
      <summary>
        <span>Server boards</span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="server-boards-content">
        <Account onAccountChange={accountChanged} refreshVersion={accountBoards.accountVersion} />
        <p className="server-boards-description">
          {activeAccount ? "Account board. A draft is also kept on this device." : "Local board. Upload only when you choose; signing in keeps it on this device."}
        </p>
        {activeAccount && <>
          <p role="status" className={accountBoards.status === "conflict" ? "server-boards-error" : undefined}>
            {accountBoards.status === "read-only" && (accessRole === "none" ? "Access removed. This local draft is read-only." : "Viewer access. This board is read-only.")}
            {accountBoards.status === "saved" && "Saved to account"}
            {accountBoards.status === "saving" && "Saving to account…"}
            {accountBoards.status === "unsaved" && "Account changes waiting to save…"}
            {accountBoards.status === "conflict" && (localSaveStatus === "saved"
              ? "This board changed elsewhere. Your edits are saved on this device."
              : localSaveStatus === "error"
                ? "This board changed elsewhere. The draft could not be saved on this device."
                : "This board changed elsewhere. Saving your draft on this device…")}
            {accountBoards.status === "error" && "Account save needs attention. Your draft stays on this device."}
            {accountBoards.status === "signed-out" && "Sign in to save this account board. Your draft stays on this device."}
          </p>
          <div className="server-board-actions">
            <button className="server-boards-refresh" type="button" disabled={accountBoards.busy || !isHydrated} onClick={() => void session.back()}>Back to local board</button>
            {userId && !readOnly && accountBoards.status === "error" && <button className="server-boards-refresh" type="button" disabled={accountBoards.busy} onClick={() => void session.save()}>Retry account save</button>}
            {userId && ["conflict", "error", "read-only"].includes(accountBoards.status) && <>
              <button className="server-boards-refresh" type="button" disabled={accountBoards.busy} onClick={() => {
                if (window.confirm("Reload the account version? Your current draft will be kept on this device.")) void session.reload();
              }}>Reload account version</button>
              <button className="server-boards-refresh" type="button" disabled={accountBoards.busy} onClick={() => void session.saveCopy()}>Save as new account board</button>
            </>}
            {userId && accountBoards.hasRecovery && <button className="server-boards-refresh" type="button" disabled={accountBoards.busy} onClick={() => void session.restore()}>Restore previous draft</button>}
          </div>
        </>}
        {localSaveStatus === "error" && <p className="server-boards-error">Couldn’t save the draft on this device. {localSaveError}</p>}
        {accountBoards.error && <p className="server-boards-error" role="alert">{accountBoards.error}</p>}
        {accountBoards.busy && <p role="status">Updating boards…</p>}
        {userId && <div className="server-board-actions">
          {!activeAccount && <button className="server-boards-refresh" type="button" disabled={accountBoards.busy || !isHydrated} onClick={() => void session.upload()}>Upload local board</button>}
          <button className="server-boards-refresh" type="button" disabled={accountBoards.busy || !isHydrated} onClick={() => void session.createBlank()}>New account board</button>
        </div>}
        {!userId && <p role="status">Sign in to see your server boards.</p>}
        {!userId && new URLSearchParams(window.location.search).has("invite") && <p>Sign in with the invited Google email, then choose Accept invitation.</p>}
        {userId && <InvitationInbox key={userId} userId={userId} session={session} />}
        {userId && sharingId && boards.data?.find((board) => board.id === sharingId && (board.role ?? "owner") === "owner") && <BoardSharing key={`${userId}:${sharingId}`} userId={userId} boardId={sharingId} title={boards.data.find((board) => board.id === sharingId)!.title} session={session} close={() => setSharingId(null)} />}
        {userId && boards.isPending && <p role="status">Loading boards…</p>}
        {userId && boards.isFetching && boards.data && <p role="status">Refreshing boards…</p>}
        {userId && boards.isError && !(boards.error instanceof BoardSignInRequired) && (
          <p className="server-boards-error" role="alert">
            {boards.data ? "Couldn’t refresh server boards. Showing the last loaded list. Try again." : "Couldn’t load server boards. Try again."}
          </p>
        )}
        {userId && boards.data && !(boards.error instanceof BoardSignInRequired) && (
          boards.data.length === 0 ? <p role="status">No server boards yet.</p> : (
            <ul className="server-boards-list" aria-label="Boards from server">
              {boards.data.map((board) => <li key={board.id} aria-current={activeAccount?.boardId === board.id ? "true" : undefined}>
                <span className="server-board-title"><span>{board.title}</span> <small>({board.role ?? "owner"})</small></span>
                <div className="server-board-actions">
                  <button className="server-boards-refresh" type="button" disabled={accountBoards.busy || !isHydrated || activeAccount?.boardId === board.id} onClick={() => void session.open(board)}>Open</button>
                  <button className="server-boards-refresh" type="button" disabled={accountBoards.busy || board.role === "viewer"} onClick={() => {
                    const title = window.prompt("Rename account board", board.title)?.trim();
                    if (title && title !== board.title) void session.rename(board, title);
                  }}>Rename</button>
                  {(board.role ?? "owner") === "owner" && <button className="server-boards-refresh" type="button" disabled={accountBoards.busy} onClick={() => {
                    if (window.confirm(`Delete “${board.title}” from your account? Local drafts will be kept on this device.`)) void session.remove(board);
                  }}>Delete</button>}
                  {(board.role ?? "owner") === "owner" && <button className="server-boards-refresh" type="button" disabled={accountBoards.busy} onClick={() => setSharingId(board.id)}>Share</button>}
                </div>
              </li>)}
            </ul>
          )
        )}
        {userId && <button
          className="server-boards-refresh"
          type="button"
          disabled={boards.isFetching}
          onClick={() => void boards.refetch()}
        >
          {boards.isError ? "Retry" : "Refresh"}
        </button>}
      </div>
    </details>
  );
}
