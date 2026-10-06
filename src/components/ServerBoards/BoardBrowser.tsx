import { useState } from "react";
import type { ServerBoard } from "../../api/boards";
import type { AccountBoardSession } from "../../persistence/accountBoardSession";
import { Dialog } from "../Dialog";
import { InvitationInbox } from "./Sharing";

export function BoardBrowser({ open, close, userId, session, boards, activeId, busy, hydrated, loading, refreshing, error, refresh, share, signIn, navigate, openDevice, navigationError, deviceActive = !activeId, initialCategory = "mine" }: {
  open: boolean; close: () => void; userId: string | null; session: AccountBoardSession;
  boards: ServerBoard[] | undefined; activeId?: string; busy: boolean; hydrated: boolean;
  loading: boolean; refreshing: boolean; error: boolean; refresh: () => void;
  share: (board: ServerBoard) => void; signIn: () => void; initialCategory?: "mine" | "shared" | "invitations";
  navigate?: (id: string) => Promise<boolean>; navigationError?: string | null;
  deviceActive?: boolean;
  openDevice?: () => Promise<boolean>;
}) {
  const [category, setCategory] = useState(initialCategory);
  const [search, setSearch] = useState("");
  const [actions, setActions] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ board: ServerBoard; kind: "rename" | "delete" } | null>(null);
  const [title, setTitle] = useState("");
  const filtered = boards?.filter((board) => (category === "mine" ? (board.role ?? "owner") === "owner" : board.role === "editor" || board.role === "viewer") && board.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const openBoard = async (board: ServerBoard) => {
    const opened = navigate ? await navigate(board.id) : await session.open(board);
    if (opened && !session.getState().error) close();
  };
  return <>
    <Dialog open={open} title="Your boards" close={close} className="board-browser">
      <div className="device-board-row"><span><strong>This device</strong><small>Your current local board</small></span>
        <button type="button" disabled={deviceActive || busy || !hydrated} onClick={async () => { const opened = await (openDevice ? openDevice() : session.back()); if (opened && !session.getState().error) close(); }}>{deviceActive ? "Current board" : "Open device board"}</button></div>
      {!userId ? <><p>{initialCategory === "invitations" ? "Sign in with the invited Google email, then choose Accept invitation." : "Sign in to see your account boards. Signing in never uploads your device board."}</p><button type="button" onClick={signIn}>Sign in</button></> : <>
        <div className="browser-categories" role="group" aria-label="Board category">
          {([ ["mine", "My boards"], ["shared", "Shared with me"], ["invitations", "Invitations"] ] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={category === id} onClick={() => { setCategory(id); setActions(null); }}>{label}</button>)}
        </div>
        {category === "invitations" ? <InvitationInbox userId={userId} session={session} opened={close} /> : <>
          <label className="dialog-field">Find a board<input type="search" value={search} placeholder="Search by title" onChange={(event) => setSearch(event.target.value)} /></label>
          {loading && <p role="status">Loading boards…</p>}
          {refreshing && boards && <p role="status">Refreshing boards…</p>}
          {error && <p role="alert">{boards ? "Couldn’t refresh account boards. Showing the last loaded list. Try again." : "Couldn’t load account boards. Try again."}</p>}
          {filtered?.length === 0 && <p>{search ? "No matching boards." : category === "shared" ? "No shared boards yet." : "No account boards yet."}</p>}
          <ul className="board-browser-list" aria-label="Account boards">
            {filtered?.map((board) => <li key={board.id} aria-current={activeId === board.id ? "true" : undefined}>
              <div className="board-browser-row">
                <button className="board-open" type="button" disabled={busy || !hydrated} onClick={() => void openBoard(board)}>
                  <strong>{board.title}</strong><small>{activeId === board.id ? "Current · " : ""}{board.role === "viewer" ? "Can view" : board.role === "editor" ? "Can edit" : "Owner"}{board.updatedAt != null ? ` · ${new Date(board.updatedAt).toLocaleDateString()}` : ""}</small>
                </button>
                {board.role !== "viewer" && <button type="button" className="icon-button" aria-label={`Actions for ${board.title}`} aria-expanded={actions === board.id} onClick={() => setActions(actions === board.id ? null : board.id)}>···</button>}
              </div>
              {actions === board.id && <div className="board-row-actions" role="group" aria-label={`Actions for ${board.title}`}>
                <button type="button" disabled={busy} onClick={() => { setTitle(board.title); setEdit({ board, kind: "rename" }); }}>Rename</button>
                {(board.role ?? "owner") === "owner" && <>
                  <button type="button" disabled={busy} onClick={() => share(board)}>Share</button>
                  <button type="button" className="danger-action" disabled={busy} onClick={() => setEdit({ board, kind: "delete" })}>Delete</button>
                </>}
              </div>}
            </li>)}
          </ul>
          <div className="dialog-actions"><button type="button" disabled={busy || !hydrated} onClick={async () => { await session.createBlank(); if (!session.getState().error) close(); }}>New account board</button>
            <button type="button" disabled={refreshing} onClick={refresh}>{error ? "Retry" : "Refresh"}</button></div>
        </>}
        {session.getState().error && <p role="alert">{session.getState().error}</p>}
        {navigationError && <p role="alert">{navigationError}</p>}
      </>}
    </Dialog>
    <Dialog open={!!edit} title={edit?.kind === "delete" ? "Delete account board" : "Rename account board"} close={() => setEdit(null)}>
      {edit && <form onSubmit={async (event) => {
        event.preventDefault();
        if (edit.kind === "delete") await session.remove(edit.board);
        else if (title.trim()) await session.rename(edit.board, title.trim());
        if (!session.getState().error) { setEdit(null); setActions(null); }
      }}>
        {edit.kind === "delete" ? <p>Delete “{edit.board.title}” from your account? Device drafts are kept. People with access will lose this board.</p> : <label className="dialog-field">New board title<input data-initial-focus required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>}
        {session.getState().error && <p role="alert">{session.getState().error}</p>}
        <div className="dialog-actions"><button className={edit.kind === "delete" ? "danger-action" : "primary-action"} type="submit" disabled={busy || (edit.kind === "rename" && !title.trim())}>{busy ? "Updating…" : edit.kind === "delete" ? "Delete board" : "Save title"}</button><button type="button" onClick={() => setEdit(null)}>Cancel</button></div>
      </form>}
    </Dialog>
  </>;
}
