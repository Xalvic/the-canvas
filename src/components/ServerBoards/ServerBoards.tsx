import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { listServerBoards, type ServerBoard } from "../../api/boards";

type BoardListState =
  | { status: "loading" }
  | { status: "success"; boards: ServerBoard[] }
  | { status: "error" };

export function ServerBoards() {
  const [state, setState] = useState<BoardListState>({ status: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadBoards() {
      try {
        const boards = await listServerBoards(controller.signal);
        if (!controller.signal.aborted) setState({ status: "success", boards });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error" });
      }
    }

    void loadBoards();
    // Ignore stale results on refresh, unmount, and Strict Mode cleanup.
    return () => controller.abort();
  }, [requestVersion]);

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
        <p className="server-boards-description">
          Board titles only. Your canvas stays on this device.
        </p>
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
        <button
          className="server-boards-refresh"
          type="button"
          disabled={state.status === "loading"}
          onClick={refreshBoards}
        >
          {state.status === "error" ? "Retry" : "Refresh"}
        </button>
      </div>
    </details>
  );
}
