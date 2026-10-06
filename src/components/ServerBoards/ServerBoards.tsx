import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BoardIdentity } from "../BoardIdentity/BoardIdentity";
import { RecoveryDialog } from "./RecoveryDialog";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { savePresentation } from "../SaveStatus";
import { BoardSignInRequired } from "../../api/boards";
import { accountBoardListOptions } from "../../api/accountBoardQueries";
import { Account } from "../Account/Account";
import { useAccountBoardSession } from "../../persistence/accountBoardSession";
import { useBoardStore } from "../../store/boardStore";
import { useUiStore } from "../../store/uiStore";
import { useDocumentStore } from "../../store/documentStore";
import { CollaborationSummary, useCollaborationCursor } from "../CollaborationPresence";
import { BoardSharing } from "./Sharing";
import { BoardBrowser } from "./BoardBrowser";
import { SaveFlow, type SaveFlowKind } from "./SaveFlow";
import { invitationIntent } from "./invitationIntent";

export function ServerBoards() {
  const { session, state: accountBoards } = useAccountBoardSession();
  const userId = accountBoards.userId;
  const boards = useQuery({ ...accountBoardListOptions(userId ?? ""), enabled: !!userId });
  const activeAccount = useBoardStore((board) => board.account);
  const accessRole = useBoardStore((board) => board.accessRole);
  const tabRecoveryId = useBoardStore((board) => board.tabRecoveryId);
  const tabReadOnly = useBoardStore((board) => board.tabReadOnly);
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
  const [browserOpen, setBrowserOpen] = useState(false);
  const [inviteLink] = useState(invitationIntent);
  const [saveFlow, setSaveFlow] = useState<SaveFlowKind | null>(null);
  const [accountOpenRequest, setAccountOpenRequest] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const status = savePresentation({ local: localSaveStatus, localError: localSaveError, cloud: accountBoards.status, account: !!activeAccount, role: accessRole, tabReadOnly, pendingImages, recovery: !!tabRecoveryId || accountBoards.hasRecovery });

  useEffect(() => useUiStore.subscribe((next, previous) => {
    if (next.activeTool !== previous.activeTool && window.matchMedia("(max-width: 767px)").matches) {
      setBrowserOpen(false);
    }
  }), []);
  const accountChanged = useCallback((id: string | null) => {
    session.setUser(id);
  }, [session]);

  useEffect(() => {
    if (userId && boards.error instanceof BoardSignInRequired) session.expire();
  }, [boards.error, userId, session]);

  useEffect(() => { setSharingId(null); setSaveFlow(null); }, [userId]);
  useEffect(() => { if (inviteLink) setBrowserOpen(true); }, [inviteLink, userId]);
  useEffect(() => {
    if (!userId || !activeAccount) return;
    void session.refreshAccess();
    const refresh = () => void session.refreshAccess();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [userId, activeAccount?.boardId, session]);

  return (
    <>
      <header className="board-header" aria-label="Board controls" onKeyDown={(event) => event.stopPropagation()}>
        <button className="boards-trigger" type="button" aria-haspopup="dialog" onClick={() => setBrowserOpen(true)}>Boards</button>
        <BoardIdentity location={activeAccount ? accessRole === "owner" ? "In your account · Owner" : `Shared with you · ${accessRole === "editor" ? "Can edit" : accessRole === "viewer" ? "Can view" : "Access removed"}` : "On this device"} />
        <button className="save-status" type="button" data-attention={status.attention} onClick={() => setDetailsOpen(true)} aria-haspopup="dialog">{status.label}</button>
        <CollaborationSummary />
        {!activeAccount && <button className="primary-action header-save" type="button" disabled={accountBoards.busy || !isHydrated} onClick={() => setSaveFlow("account")}>Save to account</button>}
        {activeAccount && userId && accessRole === "owner" && <button className="primary-action header-save" type="button" disabled={accountBoards.busy} onClick={() => setSharingId(activeAccount.boardId)}>Share</button>}
        <Account onAccountChange={accountChanged} refreshVersion={accountBoards.accountVersion} openRequest={accountOpenRequest} />
      </header>
      <StatusAnnouncement message={status.label} urgent={localSaveStatus === "error" && !tabReadOnly} />
      {(status.attention || accountBoards.error || historyError || accountBoards.busy) && <aside className="board-notice" aria-label="Board needs attention">
        <span>{status.attention ? status.label : accountBoards.error ?? historyError ?? "Updating board…"}{(tabRecoveryId || accountBoards.hasRecovery) && " · Device draft available"}</span>
        {accountBoards.imageUpload && <span>Uploading images… {accountBoards.imageUpload.completed}/{accountBoards.imageUpload.total}</span>}
        {userId && activeAccount && !readOnly && pendingImages > 0 && !accountBoards.busy && <button type="button" onClick={() => setSaveFlow("images")}>Upload and save</button>}
        {userId && activeAccount && !readOnly && pendingImages === 0 && accountBoards.status === "error" && !accountBoards.busy && <button type="button" onClick={() => void session.save()}>Retry save</button>}
        <button type="button" onClick={() => setDetailsOpen(true)}>Details</button>
      </aside>}
      <RecoveryDialog open={detailsOpen} close={() => setDetailsOpen(false)} session={session} pendingImages={pendingImages} save={(kind) => { setDetailsOpen(false); setSaveFlow(kind); }} />
      <BoardBrowser key={userId ?? "guest"} open={browserOpen} close={() => setBrowserOpen(false)} userId={userId} session={session}
        boards={boards.data} activeId={activeAccount?.boardId} busy={accountBoards.busy} hydrated={isHydrated}
        loading={!!userId && boards.isPending} refreshing={boards.isFetching} error={boards.isError && !(boards.error instanceof BoardSignInRequired)}
        initialCategory={inviteLink ? "invitations" : "mine"} refresh={() => void boards.refetch()} share={(board) => setSharingId(board.id)} signIn={() => { setBrowserOpen(false); setAccountOpenRequest((value) => value + 1); }} />
      {userId && sharingId && (activeAccount?.boardId === sharingId ? accessRole === "owner" : boards.data?.some((board) => board.id === sharingId && (board.role ?? "owner") === "owner")) && <BoardSharing key={`${userId}:${sharingId}`} userId={userId} boardId={sharingId} title={activeAccount?.boardId === sharingId ? boardTitle : boards.data?.find((board) => board.id === sharingId)?.title ?? "Account board"} session={session} close={() => setSharingId(null)} />}
      {saveFlow && <SaveFlow kind={saveFlow} session={session} imageCount={saveFlow === "images" ? pendingImages : Object.values(objects).filter((object) => object.type === "image").length} close={() => setSaveFlow(null)} signIn={() => { setSaveFlow(null); setAccountOpenRequest((value) => value + 1); }} />}
    </>
  );
}
