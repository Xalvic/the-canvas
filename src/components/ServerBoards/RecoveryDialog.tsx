import { useEffect, useState } from "react";
import type { AccountBoardSession } from "../../persistence/accountBoardSession";
import { getServerBoard } from "../../api/boards";
import { useBoardStore } from "../../store/boardStore";
import { useDocumentStore } from "../../store/documentStore";
import { useCollaborationStore } from "../../store/collaborationStore";
import { BOARD_TAB_READ_ONLY_MESSAGE } from "../../persistence/boardTabCoordinator";
import { continueGuestEditing, reopenLocalBoard, restoreInterruptedLocalBoard, retryLocalBoardSave } from "../../persistence/useLocalBoardPersistence";
import { Dialog } from "../Dialog";
import type { SaveFlowKind } from "./SaveFlow";

export function RecoveryDialog({ open, close, session, save, pendingImages }: { open: boolean; close: () => void; session: AccountBoardSession; save: (kind: SaveFlowKind) => void; pendingImages: number }) {
  const board = useBoardStore();
  const state = session.getState();
  const historyError = useDocumentStore((document) => document.historyError);
  const live = useCollaborationStore((collaboration) => collaboration.status);
  const [confirmReload, setConfirmReload] = useState(false);
  const [reopening, setReopening] = useState(false);
  const account = board.account;
  useEffect(() => { if (open) void session.refreshEditorDrafts(); }, [open, session, board.id]);
  const deviceFailed = board.saveStatus === "error" && board.saveError !== BOARD_TAB_READ_ONLY_MESSAGE;
  const localAction = (action: () => Promise<void>) => { void action().catch((error: unknown) => useBoardStore.getState().markSaveError(error instanceof Error ? error.message : "Could not restore the device draft")); };
  const reopen = async () => {
    if (reopening) return;
    setReopening(true);
    try {
      if (account && state.userId) await session.open(await getServerBoard(account.boardId, AbortSignal.timeout(20000)));
      else if (!account) await reopenLocalBoard();
    } catch (error) { useBoardStore.getState().markSaveError(error instanceof Error ? error.message : "Could not reopen the board"); }
    finally { setReopening(false); }
  };
  return <Dialog open={open} title="Save details" close={close}>
    <dl className="save-facts">
      <div><dt>On this device</dt><dd>{deviceFailed ? "Current draft could not be saved" : board.tabReadOnly ? "This tab does not own saving. This is the last loaded draft." : board.saveStatus === "saved" ? "Current draft saved" : board.saveStatus === "saving" ? "Saving current draft…" : "Opening draft…"}</dd></div>
      <div><dt>In your account</dt><dd>{!account ? "No account copy of this device board" : state.status === "saved" ? "Latest document, title and images confirmed" : state.status === "conflict" ? "This board changed elsewhere" : state.status === "signed-out" ? "Sign in to sync" : state.status === "error" ? "Latest save needs attention" : state.status === "read-only" ? "Viewing account board" : state.status === "saving" ? "Saving page…" : state.status === "pending" ? "Changes pending; retry resumes when online" : state.status === "consent" ? "Older images need upload consent" : "Changes waiting to save"}</dd></div>
      {account && <div><dt>Access</dt><dd>{board.accessRole === "owner" ? "Owner" : board.accessRole === "editor" ? "Can edit" : board.accessRole === "viewer" ? "Can view" : "Access removed"}</dd></div>}
      {account && <div><dt>Live updates</dt><dd>{live === "connected" ? "Connected" : live === "reconnecting" ? "Reconnecting…" : live === "connecting" ? "Connecting…" : "Unavailable. Save status is separate."}</dd></div>}
    </dl>
    <p className="dialog-footnote">Device storage can be cleared by your browser. Only a confirmed device write means your current draft is saved here.</p>
    {board.saveError && <p role="alert">{board.saveError}</p>}
    {state.error && state.error !== board.saveError && <p role="alert">{state.error}</p>}
    {historyError && <p role="alert">{historyError}</p>}
    {!account && board.tabReadOnly && ["passive", "contended", "unverified"].includes(board.tabOwnership) && <section><h3>Shared device drawing</h3><p>This view follows the saved drawing. Continue here after the other tab finishes its current edit.</p><button type="button" onClick={() => void continueGuestEditing()}>Continue editing here</button></section>}
    {account && board.tabReadOnly && (board.tabOwnership === "contended" || board.tabOwnership === "unverified") && <section><h3>Editing access needs checking</h3><p>Reopening checks your editor draft and current permissions.</p><button type="button" disabled={state.busy || reopening || !state.userId} onClick={() => void reopen()}>{reopening ? "Reopening…" : "Reopen here"}</button></section>}
    {board.saveStatus === "error" && (!board.tabReadOnly || board.tabOwnership === "unavailable") && <button type="button" onClick={retryLocalBoardSave}>Retry device save</button>}
    {account && state.userId && !board.readOnly && state.status === "error" && <button className="primary-action" type="button" disabled={state.busy} onClick={() => void session.retrySave()}>Retry account save</button>}
    {account && pendingImages > 0 && <p>{pendingImages} {pendingImages === 1 ? "image is" : "images are"} still waiting to upload; the account document does not contain these files yet.</p>}
    {account && state.userId && !board.readOnly && state.status === "consent" && pendingImages > 0 && <button type="button" disabled={state.busy} onClick={() => save("images")}>Allow image upload</button>}
    {account && state.userId && ["conflict", "error", "read-only"].includes(state.status) && <section>
      <h3>Choose a version</h3>
      <p>Save a copy creates a separate account board. Using the account version replaces this canvas only after its current draft and a recovery backup are saved successfully on this device.</p>
      <div className="dialog-actions"><button type="button" disabled={state.busy || board.tabReadOnly} onClick={() => save("copy")}>Save a copy</button><button type="button" disabled={state.busy || board.tabReadOnly || board.accessRole === "none"} onClick={() => setConfirmReload(true)}>Use account version</button></div>
    </section>}
    {state.userId && account && state.hasRecovery && <section><h3>Previous draft</h3><p>Restore the previous backup made before using the account version. Your current content is backed up before replacement; this does not overwrite the account version.</p><button type="button" disabled={state.busy || board.tabReadOnly} onClick={() => void session.restore()}>Restore previous draft</button></section>}
    {board.tabRecoveryId && !board.readOnly && <section><h3>Interrupted draft</h3><p>Restore the draft captured when this tab lost its editing lease. Current content is backed up before replacement.</p><button type="button" disabled={state.busy} onClick={() => { if (account) void session.restoreInterrupted(); else localAction(restoreInterruptedLocalBoard); }}>Restore interrupted draft</button></section>}
    {account && state.editorDrafts.length > 0 && <section><h3>Other editor drafts</h3><p>Pending work from other editors on this device is kept separately. A draft can be recovered after its editor releases it.</p>{state.editorDrafts.map((draft, index) => <button key={draft.id} type="button" disabled={state.busy || board.readOnly} onClick={() => void session.restoreEditorDraft(draft.id)}>Recover draft {index + 1}: {draft.title}</button>)}</section>}
    {state.busy && <p role="status">Updating board…</p>}
    {state.imageUpload && <p role="status">Uploading images… {state.imageUpload.completed}/{state.imageUpload.total}</p>}
    <Dialog open={confirmReload} title="Use account version" close={() => setConfirmReload(false)}>
      <p>Replace this canvas with the account version? The current draft must be saved and backed up on this device first. You can restore that backup from Save details.</p>
      <div className="dialog-actions"><button type="button" className="primary-action" disabled={state.busy} onClick={async () => { await session.reload(); if (!session.getState().error) setConfirmReload(false); }}>Use account version</button><button type="button" onClick={() => setConfirmReload(false)}>Cancel</button></div>
      {state.error && <p role="alert">{state.error}</p>}
    </Dialog>
  </Dialog>;
}
