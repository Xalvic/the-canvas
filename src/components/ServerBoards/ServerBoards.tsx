import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PanelLeft } from "lucide-react";
import { AppMenu } from "../AppMenu";
import { Dialog } from "../Dialog";
import { BoardIdentity } from "../BoardIdentity/BoardIdentity";
import { RecoveryDialog } from "./RecoveryDialog";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { savePresentation } from "../SaveStatus";
import { BoardSignInRequired } from "../../api/boards";
import { accountBoardListOptions, accountBoardKeys, retryBoardRead } from "../../api/accountBoardQueries";
import { getInvitations } from "../../api/sharing";
import { Account } from "../Account/Account";
import { useAccountBoardSession } from "../../persistence/accountBoardSession";
import { useBoardStore } from "../../store/boardStore";
import { useUiStore } from "../../store/uiStore";
import { useDocumentStore } from "../../store/documentStore";
import { CollaborationSummary, useCollaborationCursor } from "../CollaborationPresence";
import { BoardSharing, InvitationInbox } from "./Sharing";
import { PageSidebar } from "./PageSidebar";
import { SaveFlow, type SaveFlowKind } from "./SaveFlow";
import { invitationIntent } from "./invitationIntent";
import { useWorkspaceController } from "../../persistence/workspaceController";

export function ServerBoards() {
  const headerRef = useRef<HTMLElement>(null);
  const noticeRef = useRef<HTMLElement>(null);
  const { session, state: accountBoards } = useAccountBoardSession();
  const { workspace, state: lifecycle } = useWorkspaceController(session);
  const lifecycleUser = lifecycle.account?.status === "signed-in" ? lifecycle.account.user.id : null;
  const userId = accountBoards.userId === lifecycleUser ? accountBoards.userId : null;
  const boards = useQuery({ ...accountBoardListOptions(userId ?? ""), enabled: !!userId });
  const invitations = useQuery({ queryKey: [...accountBoardKeys.owner(userId ?? ""), "invitations"], queryFn: ({ signal }) => getInvitations(signal), enabled: !!userId, retry: retryBoardRead, networkMode: "always", refetchInterval: 30000 });
  const activeAccount = useBoardStore((board) => board.account);
  const accessRole = useBoardStore((board) => board.accessRole);
  const tabRecoveryId = useBoardStore((board) => board.tabRecoveryId);
  const tabReadOnly = useBoardStore((board) => board.tabReadOnly);
  const tabOwnership = useBoardStore((board) => board.tabOwnership);
  const readOnly = useBoardStore((board) => board.readOnly);
  const boardTitle = useBoardStore((board) => board.title);
  const objects = useDocumentStore((document) => document.objects);
  const historyError = useDocumentStore((document) => document.historyError);
  useCollaborationCursor(session.publishPresence, !!userId && !!activeAccount && accessRole !== "none");
  const pendingImages = Object.values(objects).filter((object) => object.type === "image" &&
    !Object.hasOwn(activeAccount?.imageAssets ?? {}, object.assetId) && object.cloudAsset?.boardId !== activeAccount?.boardId).length;
  const [sharingId, setSharingId] = useState<string | null>(null);
  const isHydrated = useBoardStore((board) => board.isHydrated);
  const localSaveStatus = useBoardStore((board) => board.saveStatus);
  const localSaveError = useBoardStore((board) => board.saveError);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inviteLink] = useState(invitationIntent);
  const [saveFlow, setSaveFlow] = useState<SaveFlowKind | null>(null);
  const [accountOpenRequest, setAccountOpenRequest] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const status = savePresentation({ local: localSaveStatus, localError: localSaveError, cloud: accountBoards.status, account: !!activeAccount, role: accessRole, tabReadOnly, tabOwnership, pendingImages, recovery: !!tabRecoveryId });

  useLayoutEffect(() => {
    const header = headerRef.current, shell = header?.closest<HTMLElement>(".app-shell");
    if (!header || !shell) return;
    // Measure chrome only. The canvas keeps its full size and world origin.
    const measure = () => shell.style.setProperty("--workspace-chrome-top", `${header.getBoundingClientRect().bottom - shell.getBoundingClientRect().top + 10}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(header); measure();
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); shell.style.removeProperty("--workspace-chrome-top"); };
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport, shell = headerRef.current?.closest<HTMLElement>(".app-shell");
    if (!viewport || !shell) return;
    const measure = () => {
      shell.style.setProperty("--visual-height", `${viewport.height}px`);
      shell.style.setProperty("--visual-top", `${viewport.offsetTop}px`);
    };
    measure(); viewport.addEventListener("resize", measure); viewport.addEventListener("scroll", measure);
    return () => {
      viewport.removeEventListener("resize", measure); viewport.removeEventListener("scroll", measure);
      shell.style.removeProperty("--visual-height"); shell.style.removeProperty("--visual-top");
    };
  }, []);

  useEffect(() => useUiStore.subscribe((next, previous) => {
    if (next.activeTool !== previous.activeTool && window.matchMedia("(max-width: 767px)").matches) {
      setSidebarOpen(false);
    }
  }), []);
  useEffect(() => {
    if (userId && boards.error instanceof BoardSignInRequired) session.expire();
  }, [boards.error, userId, session]);

  useEffect(() => { setSharingId(null); setSaveFlow(null); setDetailsOpen(false); }, [userId]);
  useEffect(() => { if (inviteLink) setInboxOpen(true); }, [inviteLink, userId]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const restore = () => {
      setMobile(media.matches);
      let visible = true;
      try { visible = localStorage.getItem(`scribble:page-sidebar:${userId}`) !== "closed"; } catch { /* Visibility is optional. */ }
      setSidebarOpen(!!userId && !media.matches && visible);
    };
    restore(); media.addEventListener("change", restore);
    return () => media.removeEventListener("change", restore);
  }, [userId]);
  useEffect(() => { if (userId && invitations.error instanceof BoardSignInRequired) session.expire(); }, [userId, invitations.error, session]);
  const changeSidebar = (open: boolean) => {
    setSidebarOpen(open);
    if (!mobile && userId) try { localStorage.setItem(`scribble:page-sidebar:${userId}`, open ? "open" : "closed"); } catch { /* Visibility is optional. */ }
    if (!open) document.querySelector<HTMLButtonElement>(".sidebar-trigger")?.focus();
  };
  useEffect(() => {
    if (!userId || !activeAccount) return;
    void session.refreshAccess();
    const refresh = () => void session.refreshAccess();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [userId, activeAccount?.boardId, session]);

  const blocked = lifecycle.status === "signing-out" || !!activeAccount && activeAccount.ownerId !== lifecycleUser ||
    !!lifecycleUser && lifecycle.phase !== "device" && (lifecycle.phase !== "ready" || !activeAccount);
  useLayoutEffect(() => {
    const editor = document.getElementById("canvas-editor");
    // Keep its measured size: display:none would recenter the world on every open.
    if (editor) { editor.inert = blocked; editor.style.visibility = blocked ? "hidden" : ""; editor.setAttribute("aria-hidden", String(blocked)); }
    return () => { if (editor) { editor.inert = false; editor.style.visibility = ""; editor.removeAttribute("aria-hidden"); } };
  }, [blocked]);
  const busy = accountBoards.busy || !!lifecycle.creatingPage || !isHydrated;
  const inboxEntry = (userId && (invitations.data?.length || invitations.isError) || inviteLink) ? <button type="button" onClick={() => setInboxOpen(true)}>Invitations{invitations.data?.length ? ` (${invitations.data.length})` : ""}</button> : null;
  const consentNotice = activeAccount && accountBoards.status === "consent" && !readOnly && localSaveStatus !== "error" && !historyError;
  const deviceFailure = localSaveStatus === "error" && !tabReadOnly || !!historyError;
  const notice = deviceFailure ? historyError ?? status.label : lifecycle.creationError ?? lifecycle.error ?? (consentNotice ? "These older images need your permission to upload. Their files stay on this device." : status.attention || accountBoards.error ? accountBoards.error ?? status.label : null);

  useLayoutEffect(() => {
    const notice = noticeRef.current, header = headerRef.current, shell = header?.closest<HTMLElement>(".app-shell");
    if (!notice || !header || !shell) return;
    const measure = () => shell.style.setProperty("--workspace-content-top", `${notice.getBoundingClientRect().bottom - shell.getBoundingClientRect().top + 12}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(header); observer.observe(notice); measure();
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); shell.style.removeProperty("--workspace-content-top"); };
  }, [!!notice, blocked]);

  return (
    <>
      <header ref={headerRef} className="board-header workspace-header" data-sidebar={userId && sidebarOpen && !mobile} aria-label="Canvas controls" onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
        <AppMenu details={() => setDetailsOpen(true)} blocked={blocked} />
        {userId && <button className="sidebar-trigger icon-button" type="button" aria-label="Pages" aria-expanded={sidebarOpen} aria-haspopup={mobile ? "dialog" : undefined} onClick={() => changeSidebar(!sidebarOpen)}><PanelLeft size={20} aria-hidden="true" /></button>}
        {!blocked ? <BoardIdentity location={activeAccount && accessRole !== "owner" ? accessRole === "editor" ? "Can edit" : accessRole === "viewer" ? "Can view" : "Access removed" : undefined} /> : <strong className="workspace-brand">Scribble</strong>}
        <div className="header-spacer" />
        {!blocked && activeAccount && !status.attention && <button className="save-status" type="button" onClick={() => setDetailsOpen(true)} aria-haspopup="dialog">{status.label}</button>}
        {!blocked && <CollaborationSummary />}
        {!blocked && activeAccount && userId && accessRole === "owner" && <button className="primary-action header-save" type="button" disabled={accountBoards.busy} onClick={() => setSharingId(activeAccount.boardId)}>Share</button>}
        <Account workspace={workspace} lifecycle={lifecycle} openRequest={accountOpenRequest} />
      </header>
      {userId && <PageSidebar key={userId} open={sidebarOpen} mobile={mobile} close={() => changeSidebar(false)} session={session} boards={boards.data} activeId={!blocked ? activeAccount?.boardId : undefined} busy={busy}
        loading={boards.isPending} refreshing={boards.isFetching} error={boards.isError && !(boards.error instanceof BoardSignInRequired)} refresh={() => void boards.refetch()}
        navigate={workspace.openPage} newPage={workspace.newPage} invitations={inboxEntry} />}
      {!userId && inviteLink && <aside className="invitation-entry" aria-label="Invitation">{inboxEntry}</aside>}
      {blocked && <section className="workspace-gate" aria-label="Workspace" aria-live="polite">
        <p>{lifecycle.status === "signing-out" ? "Signing out…" : lifecycle.phase === "empty" ? "Your workspace is empty." : lifecycle.phase === "transfer-pending" ? lifecycle.transferProgress ?? "Your drawing transfer is ready to resume." : lifecycle.phase === "error" || lifecycle.status === "service-error" ? "Couldn’t open your workspace." : "Opening your workspace…"}</p>
        {lifecycle.phase === "transfer-pending" && lifecycle.transfer && !lifecycle.transferProgress && <>
          <button type="button" onClick={() => void workspace.resumeTransfer()}>Retry transfer</button>
          <button type="button" onClick={() => void workspace.pauseTransfer()}>Pause transfer and open workspace</button>
        </>}
        {lifecycle.phase === "empty" && <button type="button" disabled={busy} onClick={() => void workspace.newPage()}>New page</button>}
        {!lifecycle.creationError && (lifecycle.error || accountBoards.error) && <p role="alert">{lifecycle.error ?? accountBoards.error}</p>}
        {!lifecycle.creationError && (lifecycle.error || lifecycle.phase === "error") && <button type="button" onClick={() => void workspace.retry()}>Retry workspace</button>}
        {lifecycle.creationError && <><p role="alert">{lifecycle.creationError}</p><button type="button" disabled={busy} onClick={() => void workspace.newPage()}>Retry new page</button></>}
      </section>}
      {!blocked && activeAccount && !status.attention && <StatusAnnouncement message={status.label} />}
      {!blocked && notice && <aside ref={noticeRef} className="board-notice" aria-label={consentNotice ? "Older image consent" : "Drawing needs attention"}>
        <span role="alert">{notice}{(tabRecoveryId || accountBoards.hasRecovery) && " · Device draft available"}</span>
        {deviceFailure ? <button type="button" onClick={() => setDetailsOpen(true)}>Details</button> : lifecycle.creationError ? <button type="button" disabled={busy} onClick={() => void workspace.newPage()}>Retry new page</button> : lifecycle.error ? <button type="button" onClick={() => void workspace.retry()}>Retry workspace</button> : consentNotice ? <button type="button" disabled={busy} onClick={() => setSaveFlow("images")}>Review image upload</button> : <>
          {userId && activeAccount && !readOnly && accountBoards.status === "error" && !busy && <button type="button" onClick={() => void session.retrySave()}>Retry save</button>}
          <button type="button" onClick={() => setDetailsOpen(true)}>Details</button>
        </>}
      </aside>}
      <RecoveryDialog open={detailsOpen && !blocked} close={() => setDetailsOpen(false)} session={session} pendingImages={pendingImages} save={(kind) => { setDetailsOpen(false); setSaveFlow(kind); }} />
      <Dialog open={inboxOpen} title="Invitations" close={() => setInboxOpen(false)}>
        {userId ? <InvitationInbox key={userId} userId={userId} session={session} navigate={workspace.openPage} opened={() => setInboxOpen(false)} /> : <><p>Sign in with the invited Google email, then choose Accept invitation.</p><button type="button" onClick={() => { setInboxOpen(false); setAccountOpenRequest((value) => value + 1); }}>Sign in with Google</button></>}
      </Dialog>
      {userId && sharingId && (activeAccount?.boardId === sharingId ? accessRole === "owner" : boards.data?.some((board) => board.id === sharingId && (board.role ?? "owner") === "owner")) && <BoardSharing key={`${userId}:${sharingId}`} userId={userId} boardId={sharingId} title={activeAccount?.boardId === sharingId ? boardTitle : boards.data?.find((board) => board.id === sharingId)?.title ?? "Account board"} session={session} close={() => setSharingId(null)} />}
      {userId && saveFlow && <SaveFlow kind={saveFlow} session={session} imageCount={saveFlow === "images" ? pendingImages : Object.values(objects).filter((object) => object.type === "image").length} close={() => setSaveFlow(null)} />}
    </>
  );
}
