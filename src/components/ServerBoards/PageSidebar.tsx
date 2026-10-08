import { useState, type ReactNode } from "react";
import { MoreHorizontal, PanelLeftClose, Search } from "lucide-react";
import type { ServerBoard } from "../../api/boards";
import type { AccountBoardSession } from "../../persistence/accountBoardSession";
import { useBoardStore } from "../../store/boardStore";
import { Dialog } from "../Dialog";
import { Menu } from "../Menu";

export function PageSidebar({ open, mobile, close, session, boards, activeId, busy, loading, error, retrying, retry, navigate, newPage, invitations, accountSlot, utilitiesSlot }: {
  open: boolean; mobile: boolean; close: () => void; session: AccountBoardSession;
  boards: ServerBoard[] | undefined; activeId?: string; busy: boolean; loading: boolean; error: boolean; retrying: boolean;
  retry: () => void; navigate: (id: string) => Promise<boolean>; newPage: () => Promise<boolean>; invitations: ReactNode;
  accountSlot: (element: HTMLDivElement | null) => void; utilitiesSlot: (element: HTMLDivElement | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<{ board: ServerBoard; title: string } | null>(null);
  const [deleting, setDeleting] = useState<ServerBoard | null>(null);
  const currentTitle = useBoardStore((state) => state.title);
  const currentRole = useBoardStore((state) => state.accessRole);
  const shared = boards?.filter((board) => board.role === "editor" || board.role === "viewer") ?? [];
  const owned = boards?.filter((board) => (board.role ?? "owner") === "owner") ?? [];
  async function rename() {
    if (!edit || busy || !edit.title.trim()) return;
    await session.rename(edit.board, edit.title.trim());
    if (!session.getState().error) setEdit(null);
  }
  const group = (label: string, pages: ServerBoard[]) => <section aria-label={label}>
    <h3>{label}</h3>
    <ul className="page-list" aria-label={label}>
      {pages.filter((board) => (board.id === activeId ? currentTitle : board.title).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map((board) => {
        const title = board.id === activeId ? currentTitle : board.title;
        const role = board.id === activeId ? currentRole : board.role ?? "owner";
        const canRename = role === "owner" || role === "editor";
        return <li key={board.id} aria-current={board.id === activeId ? "page" : undefined}>
          {edit?.board.id === board.id && canRename ? <input className="page-rename" autoFocus aria-label={`Rename ${board.title}`} maxLength={120} value={edit.title} disabled={busy}
            onFocus={(event) => event.currentTarget.select()} onChange={(event) => setEdit({ ...edit, title: event.target.value })}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEdit(null); }
              if (event.key === "Enter") { event.preventDefault(); void rename(); }
            }} onBlur={() => { if (!busy) setEdit(null); }} /> : <button className="page-open" type="button" aria-current={board.id === activeId ? "page" : undefined} disabled={busy}
              title={title} onClick={async () => { if (await navigate(board.id) && mobile) close(); }}><span>{title}</span>{board.role && board.role !== "owner" && <small>{board.role === "editor" ? "Can edit" : "Can view"}</small>}</button>}
          {canRename && <Menu viewportBounded label={`Actions for ${title}`} trigger={<MoreHorizontal size={18} aria-hidden="true" />} triggerClass="icon-button page-actions">
            <button type="button" role="menuitem" disabled={busy} onClick={() => setEdit({ board, title })}>Rename</button>
            {role === "owner" && <button type="button" role="menuitem" className="danger-action" disabled={busy} onClick={() => setDeleting(board)}>Delete</button>}
          </Menu>}
        </li>;
      })}
    </ul>
  </section>;
  const content = <>
    <div className="sidebar-heading"><span className="sidebar-brand"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" aria-hidden="true" /><strong>Scribble</strong></span>{!mobile && <button className="icon-button" type="button" aria-label="Close page sidebar" onClick={close}><PanelLeftClose size={20} aria-hidden="true" /></button>}</div>
    <label className="sidebar-search"><Search size={18} aria-hidden="true" /><span className="visually-hidden">Find a page</span><input type="search" placeholder="Find a page" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    <button className="new-page" type="button" disabled={busy} onClick={async () => { if (await newPage() && mobile) close(); }}>+ New page</button>
    <div className="sidebar-pages">
    {loading && <p role="status">Loading pages…</p>}
    {error && <p role="alert">{boards ? "Couldn’t update pages. Showing the last loaded list." : "Couldn’t load pages."} <button type="button" disabled={retrying} onClick={retry}>Retry pages</button></p>}
    {!loading && !error && boards?.length === 0 && <p>No pages yet. Create a new page to start.</p>}
    {search && boards?.length && !boards.some((board) => (board.id === activeId ? currentTitle : board.title).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ? <p>No matching pages.</p> : null}
    {group("My pages", owned)}
    {shared.length > 0 && group("Shared with me", shared)}
    </div>
    <div className="sidebar-footer">
      {invitations && <div className="sidebar-list-actions">{invitations}</div>}
      <div ref={utilitiesSlot} className="sidebar-utilities" />
      <div ref={accountSlot} className="sidebar-account" />
    </div>
  </>;
  return <>
    {mobile ? <Dialog open={open} title="Pages" close={close} dismissOnBackdrop className="page-sidebar page-sidebar-mobile">{content}</Dialog> : open && <aside id="page-sidebar" className="page-sidebar" aria-label="Pages" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); close(); }
    }} onKeyUp={(event) => event.stopPropagation()}>{content}</aside>}
    <Dialog open={!!deleting} title="Delete page" close={() => setDeleting(null)}>
      <p>Delete “{deleting?.title}”? Device drafts are kept. People with access will lose this page.</p>
      {session.getState().error && <p role="alert">{session.getState().error}</p>}
      <div className="dialog-actions"><button className="danger-action" type="button" disabled={busy} onClick={async () => {
        if (deleting && await session.remove(deleting)) setDeleting(null);
      }}>Delete page</button><button type="button" onClick={() => setDeleting(null)}>Cancel</button></div>
    </Dialog>
  </>;
}
