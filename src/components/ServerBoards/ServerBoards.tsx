import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, PanelLeft } from "lucide-react";
import { AppMenu } from "../AppMenu";
import { Dialog } from "../Dialog";
import { BoardIdentity } from "../BoardIdentity/BoardIdentity";
import { RecoveryDialog } from "./RecoveryDialog";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { savePresentation } from "../SaveStatus";
import { BoardSignInRequired } from "../../api/boards";
import { accountBoardListOptions, accountInvitationListOptions, accountBoardKeys } from "../../api/accountBoardQueries";
import { Account } from "../Account/Account";
import { useAccountBoardSession } from "../../persistence/accountBoardSession";
import { useBoardStore } from "../../store/boardStore";
import { useUiStore } from "../../store/uiStore";
import { useDocumentStore } from "../../store/documentStore";
import { CollaborationSummary, useCollaborationCursor } from "../CollaborationPresence";
import { InvitationInbox } from "./Sharing";
import { ShareControls } from "./ShareControls";
import { PageSidebar } from "./PageSidebar";
import { SaveFlow, type SaveFlowKind } from "./SaveFlow";
import { invitationIntent } from "./invitationIntent";
import { useWorkspaceController } from "../../persistence/workspaceController";
import { useVisiblePolling } from "./useVisiblePolling";

export function ServerBoards() {
  const titleControlsRef = useRef<HTMLDivElement>(null);
  const shareControlsRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLElement>(null);
  const [shareFeedback, setShareFeedback] = useState<HTMLElement | null>(null);
  const [footerAccountTarget, setFooterAccountTarget] = useState<HTMLDivElement | null>(null);
  const [cornerAccountTarget, setCornerAccountTarget] = useState<HTMLDivElement | null>(null);
  const [footerUtilitiesTarget, setFooterUtilitiesTarget] = useState<HTMLDivElement | null>(null);
  const { session, state: accountBoards } = useAccountBoardSession();
  const { workspace, state: lifecycle } = useWorkspaceController(session);
  const lifecycleUser = lifecycle.account?.status === "signed-in" ? lifecycle.account.user.id : null;
  const userId = accountBoards.userId === lifecycleUser ? accountBoards.userId : null;
  const queryClient = useQueryClient();
  const activeAccount = useBoardStore((board) => board.account);
  const sessionVersion = useBoardStore((board) => board.sessionVersion);
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
  const [drawer, setDrawer] = useState(() => window.matchMedia("(max-width: 1100px)").matches);
  const [inboxOpen, setInboxOpen] = useState(false);
  const visiblePolling = useVisiblePolling();
  const boards = useQuery({ ...accountBoardListOptions(userId ?? ""), enabled: !!userId, refetchInterval: sidebarOpen ? visiblePolling : false });
  // One polling observer owns the invitation cache, including while its dialog is open.
  const invitations = useQuery({ ...accountInvitationListOptions(userId ?? ""), enabled: !!userId, refetchInterval: sidebarOpen || inboxOpen ? visiblePolling : false });
  const [inviteLink] = useState(invitationIntent);
  const [saveFlow, setSaveFlow] = useState<SaveFlowKind | null>(null);
  const [accountOpenRequest, setAccountOpenRequest] = useState(0);
  const [guestShareRequest, setGuestShareRequest] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const status = savePresentation({ local: localSaveStatus, localError: localSaveError, cloud: accountBoards.status, account: !!activeAccount, role: accessRole, tabReadOnly, tabOwnership, pendingImages, recovery: !!tabRecoveryId });

  useEffect(() => {
    const viewport = window.visualViewport, shell = titleControlsRef.current?.closest<HTMLElement>(".app-shell");
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
    if (next.activeTool !== previous.activeTool && window.matchMedia("(max-width: 1100px)").matches) {
      setSidebarOpen(false);
    }
  }), []);
  useEffect(() => {
    if (userId && boards.error instanceof BoardSignInRequired) session.expire();
  }, [boards.error, userId, session]);

  useEffect(() => { setSharingId(null); setSaveFlow(null); setDetailsOpen(false); }, [userId]);
  useEffect(() => { if (inviteLink) setInboxOpen(true); }, [inviteLink, userId]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1100px)");
    const restore = () => {
      setDrawer(media.matches);
      let visible = true;
      try { visible = localStorage.getItem(`scribble:page-sidebar:${userId}`) !== "closed"; } catch { /* Visibility is optional. */ }
      setSidebarOpen(!!userId && !media.matches && visible);
    };
    restore(); media.addEventListener("change", restore);
    return () => media.removeEventListener("change", restore);
  }, [userId]);
  useEffect(() => { if (userId && invitations.error instanceof BoardSignInRequired) session.expire(); }, [userId, invitations.error, session]);
  useEffect(() => {
    if (!userId || !sidebarOpen || !visiblePolling) return;
    void queryClient.refetchQueries({ queryKey: accountBoardKeys.list(userId), exact: true, stale: true }, { cancelRefetch: false });
    void queryClient.refetchQueries({ queryKey: accountBoardKeys.invitations(userId), exact: true, stale: true }, { cancelRefetch: false });
  }, [queryClient, userId, sidebarOpen, visiblePolling]);
  useEffect(() => {
    if (!userId) return;
    const refresh = () => {
      if (document.visibilityState === "hidden" || navigator.onLine === false) return;
      // TanStack handles visibility/reconnect. Also cover focus without a visibility change.
      void queryClient.refetchQueries({ queryKey: accountBoardKeys.owner(userId), type: "active", stale: true,
        predicate: (query) => ["list", "invitations", "sharing"].includes(String(query.queryKey[2])) }, { cancelRefetch: false });
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [queryClient, userId]);
  const changeSidebar = (open: boolean) => {
    setSidebarOpen(open);
    if (!drawer && userId) try { localStorage.setItem(`scribble:page-sidebar:${userId}`, open ? "open" : "closed"); } catch { /* Visibility is optional. */ }
    if (!open) document.querySelector<HTMLButtonElement>(".sidebar-trigger")?.focus();
  };
  useEffect(() => {
    if (!userId || !activeAccount || !visiblePolling) return;
    const refresh = () => {
      if (document.visibilityState !== "hidden" && navigator.onLine !== false) void session.refreshAccess();
    };
    refresh();
    const timer = setInterval(refresh, visiblePolling);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [userId, activeAccount?.boardId, session, visiblePolling]);

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
    const title = titleControlsRef.current, share = shareControlsRef.current;
    const notice = noticeRef.current, shell = title?.closest<HTMLElement>(".app-shell");
    if (!title || !share || !shell) return;
    // Measure the independent overlays, never the canvas or a spanning header.
    const measure = () => {
      const origin = shell.getBoundingClientRect().top;
      const top = Math.max(title.getBoundingClientRect().bottom, share.getBoundingClientRect().bottom) - origin + 12;
      shell.style.setProperty("--workspace-actions-width", `${share.getBoundingClientRect().width}px`);
      shell.style.setProperty("--workspace-chrome-top", `${top}px`);
      const noticeBottom = notice ? notice.getBoundingClientRect().bottom - origin + 12 : top;
      shell.style.setProperty("--workspace-notice-bottom", `${noticeBottom}px`);
      shell.style.setProperty("--workspace-content-top", `${Math.max(noticeBottom, shareFeedback ? shareFeedback.getBoundingClientRect().bottom - origin + 12 : top)}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(title); observer.observe(share); if (notice) observer.observe(notice); if (shareFeedback) observer.observe(shareFeedback); measure();
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect(); window.removeEventListener("resize", measure);
      shell.style.removeProperty("--workspace-chrome-top"); shell.style.removeProperty("--workspace-content-top"); shell.style.removeProperty("--workspace-actions-width");
      shell.style.removeProperty("--workspace-notice-bottom");
    };
  }, [!!notice, blocked, sidebarOpen, drawer, shareFeedback]);

  return (
    <>
      <div className="workspace-controls" role="group" aria-label="Canvas controls" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
        <div ref={titleControlsRef} className="workspace-title-controls">
          {userId && <button className="ui-button sidebar-trigger icon-button" type="button" aria-label="Pages" aria-expanded={sidebarOpen} aria-haspopup={drawer ? "dialog" : undefined} onClick={() => changeSidebar(!sidebarOpen)}><PanelLeft size={20} aria-hidden="true" /></button>}
          {!blocked ? <BoardIdentity location={activeAccount && accessRole !== "owner" ? accessRole === "editor" ? "Can edit" : accessRole === "viewer" ? "Can view" : "Access removed" : undefined} /> : <strong className="workspace-brand">Scribble</strong>}
          <AppMenu details={() => setDetailsOpen(true)} blocked={blocked} footerTarget={footerUtilitiesTarget}
            linkSettings={!blocked && activeAccount && userId && accessRole === "owner" ? () => setSharingId(activeAccount.boardId) : undefined} />
          {!blocked && activeAccount && !status.attention && <button className="ui-button save-status icon-button" type="button" title={status.label} aria-label={status.label} onClick={() => setDetailsOpen(true)} aria-haspopup="dialog">{status.label === "Saved to account" ? <Check size={18} aria-hidden="true" /> : <Clock3 size={18} aria-hidden="true" />}</button>}
        </div>
        <div ref={shareControlsRef} className="workspace-share-controls">
          {!blocked && <CollaborationSummary />}
          {!blocked && activeAccount && userId && accessRole === "owner" && lifecycle.account?.status === "signed-in" && <ShareControls key={`${userId}:${activeAccount.boardId}:${sessionVersion}`}
            account={lifecycle.account} boardId={activeAccount.boardId} version={sessionVersion} title={boardTitle} session={session} workspace={workspace}
            settingsOpen={sharingId === activeAccount.boardId} closeSettings={() => setSharingId(null)}
            feedbackSlot={setShareFeedback}
            pendingChanges={accountBoards.status !== "saved" || pendingImages > 0}
            autoCopy={lifecycle.shareDestination?.userId === userId && lifecycle.shareDestination.boardId === activeAccount.boardId} />}
          {!blocked && !activeAccount && <button className="ui-button primary-action header-save" type="button" disabled={busy} onClick={() => setGuestShareRequest((value) => value + 1)}>Share</button>}
          <div ref={setCornerAccountTarget} className="workspace-account-corner" />
        </div>
      </div>
      <Account workspace={workspace} lifecycle={lifecycle} openRequest={accountOpenRequest} shareDrawingRequest={guestShareRequest} triggerTarget={footerAccountTarget ?? cornerAccountTarget} inSidebar={!!footerAccountTarget} />
      {lifecycle.sharedPage && <section className="shared-page-entry ui-status" aria-label="Shared page" data-tone={lifecycle.sharedPage === "error" || lifecycle.sharedPage === "unavailable" ? "error" : "pending"} onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
        <p role={lifecycle.sharedPage === "error" || lifecycle.sharedPage === "unavailable" ? "alert" : "status"}>{lifecycle.sharedPage === "sign-in" ? "Sign in with Google to open this page." : lifecycle.sharedPage === "opening" ? "Opening the shared page…" : lifecycle.error ?? "This shared page is unavailable. Ask its owner for a current link."}</p>
        {lifecycle.sharedPage === "sign-in" && <button className="ui-button primary-action" type="button" onClick={() => setAccountOpenRequest((value) => value + 1)}>Sign in to open page</button>}
        {lifecycle.sharedPage === "error" && <button className="ui-button" type="button" onClick={() => void workspace.retry()}>Retry shared page</button>}
      </section>}
      {userId && <PageSidebar key={userId} open={sidebarOpen} mobile={drawer} close={() => changeSidebar(false)} session={session} boards={boards.data} activeId={!blocked ? activeAccount?.boardId : undefined} busy={busy}
        loading={boards.isPending} retrying={boards.isFetching} error={boards.isError && !(boards.error instanceof BoardSignInRequired)} retry={() => void boards.refetch({ cancelRefetch: false })}
        navigate={workspace.openPage} newPage={workspace.newPage} invitations={inboxEntry} accountSlot={setFooterAccountTarget} utilitiesSlot={setFooterUtilitiesTarget} />}
      {!userId && inviteLink && <aside className="invitation-entry" aria-label="Invitation">{inboxEntry}</aside>}
      {blocked && !lifecycle.sharedPage && <section className="workspace-gate" aria-label="Workspace" aria-live="polite">
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
      {!blocked && notice && <aside ref={noticeRef} className="board-notice" onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()} data-tone={deviceFailure || lifecycle.creationError || lifecycle.error || accountBoards.error || accessRole === "none" || tabOwnership === "unavailable" ? "error" : "pending"} aria-label={consentNotice ? "Older image consent" : "Drawing needs attention"}>
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
      {userId && saveFlow && <SaveFlow kind={saveFlow} session={session} imageCount={saveFlow === "images" ? pendingImages : Object.values(objects).filter((object) => object.type === "image").length} close={() => setSaveFlow(null)} />}
    </>
  );
}
