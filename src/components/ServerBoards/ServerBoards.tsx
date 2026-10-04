import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { BoardSignInRequired, listServerBoards, type ServerBoard } from "../../api/boards";
import { Account } from "../Account/Account";
import { useAccountBoardSession } from "../../persistence/accountBoardSession";
import { useBoardStore } from "../../store/boardStore";
import { useUiStore } from "../../store/uiStore";

type BoardListState =
  | { status: "signed-out" }
  | { status: "loading" }
  | { status: "success"; boards: ServerBoard[] }
  | { status: "error" };

export function ServerBoards() {
  const [state, setState] = useState<BoardListState>({ status: "signed-out" });
  const [userId, setUserId] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [accountVersion, setAccountVersion] = useState(0);
  const { session, state: accountBoards } = useAccountBoardSession();
  const activeAccount = useBoardStore((board) => board.account);
  const isHydrated = useBoardStore((board) => board.isHydrated);
  const localSaveStatus = useBoardStore((board) => board.saveStatus);
  const localSaveError = useBoardStore((board) => board.saveError);
  const listRequest = useRef<AbortController | null>(null);
  const panel = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => useUiStore.subscribe((next, previous) => {
    if (next.activeTool !== previous.activeTool && window.matchMedia("(max-width: 767px)").matches && panel.current) {
      panel.current.open = false;
    }
  }), []);
  const accountChanged = useCallback((id: string | null) => {
    listRequest.current?.abort();
    setUserId(id);
    setState(id ? { status: "loading" } : { status: "signed-out" });
    session.setUser(id);
  }, [session]);

  useEffect(() => {
    if (!accountBoards.userId && userId) {
      listRequest.current?.abort();
      setUserId(null);
      setState({ status: "signed-out" });
    }
  }, [accountBoards.userId, userId]);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    listRequest.current = controller;

    async function loadBoards() {
      try {
        const boards = await listServerBoards(controller.signal);
        if (!controller.signal.aborted) setState({ status: "success", boards });
      } catch (error) {
        if (!controller.signal.aborted) {
          if (error instanceof BoardSignInRequired) {
            setUserId(null);
            setState({ status: "signed-out" });
            setAccountVersion((version) => version + 1);
            session.expire();
          } else setState({ status: "error" });
        }
      }
    }

    void loadBoards();
    // Ignore stale results on refresh, unmount, and Strict Mode cleanup.
    return () => controller.abort();
  }, [requestVersion, userId, accountBoards.listVersion, session]);

  function refreshBoards() {
    setState({ status: "loading" });
    setRequestVersion((version) => version + 1);
  }

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
        <Account onAccountChange={accountChanged} refreshVersion={accountVersion + accountBoards.accountVersion} />
        <p className="server-boards-description">
          {activeAccount ? "Account board. A draft is also kept on this device." : "Local board. Upload only when you choose; signing in keeps it on this device."}
        </p>
        {activeAccount && <>
          <p role="status" className={accountBoards.status === "conflict" ? "server-boards-error" : undefined}>
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
            {userId && accountBoards.status === "error" && <button className="server-boards-refresh" type="button" disabled={accountBoards.busy} onClick={() => void session.save()}>Retry account save</button>}
            {userId && ["conflict", "error"].includes(accountBoards.status) && <>
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
        {state.status === "signed-out" && <p role="status">Sign in to see your server boards.</p>}
        {state.status === "loading" && <p role="status">Loading boards…</p>}
        {state.status === "error" && (
          <p className="server-boards-error" role="alert">
            Couldn’t load server boards. Try again.
          </p>
        )}
        {state.status === "success" && (
          state.boards.length === 0 ? <p role="status">No server boards yet.</p> : (
            <ul className="server-boards-list" aria-label="Boards from server">
              {state.boards.map((board) => <li key={board.id} aria-current={activeAccount?.boardId === board.id ? "true" : undefined}>
                <span className="server-board-title">{board.title}</span>
                <div className="server-board-actions">
                  <button className="server-boards-refresh" type="button" disabled={accountBoards.busy || !isHydrated || activeAccount?.boardId === board.id} onClick={() => void session.open(board)}>Open</button>
                  <button className="server-boards-refresh" type="button" disabled={accountBoards.busy} onClick={() => {
                    const title = window.prompt("Rename account board", board.title)?.trim();
                    if (title && title !== board.title) void session.rename(board, title);
                  }}>Rename</button>
                  <button className="server-boards-refresh" type="button" disabled={accountBoards.busy} onClick={() => {
                    if (window.confirm(`Delete “${board.title}” from your account? Local drafts will be kept on this device.`)) void session.remove(board);
                  }}>Delete</button>
                </div>
              </li>)}
            </ul>
          )
        )}
        {state.status !== "signed-out" && <button
          className="server-boards-refresh"
          type="button"
          disabled={state.status === "loading"}
          onClick={refreshBoards}
        >
          {state.status === "error" ? "Retry" : "Refresh"}
        </button>}
      </div>
    </details>
  );
}
