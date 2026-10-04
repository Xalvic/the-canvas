import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { BoardSignInRequired, listServerBoards, type ServerBoard } from "../../api/boards";
import { Account } from "../Account/Account";

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
  const listRequest = useRef<AbortController | null>(null);
  const accountChanged = useCallback((id: string | null) => {
    listRequest.current?.abort();
    setUserId(id);
    setState(id ? { status: "loading" } : { status: "signed-out" });
  }, []);

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
          } else setState({ status: "error" });
        }
      }
    }

    void loadBoards();
    // Ignore stale results on refresh, unmount, and Strict Mode cleanup.
    return () => controller.abort();
  }, [requestVersion, userId]);

  function refreshBoards() {
    setState({ status: "loading" });
    setRequestVersion((version) => version + 1);
  }

  return (
    <details
      className="server-boards"
      open
      onKeyDown={(event) => event.stopPropagation()}
    >
      <summary>
        <span>Server boards</span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="server-boards-content">
        <Account onAccountChange={accountChanged} refreshVersion={accountVersion} />
        <p className="server-boards-description">
          Board titles only. Your canvas stays on this device.
        </p>
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
              {state.boards.map((board) => <li key={board.id}>{board.title}</li>)}
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
