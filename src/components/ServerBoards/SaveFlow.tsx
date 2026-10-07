import { useState } from "react";
import type { AccountBoardSession } from "../../persistence/accountBoardSession";
import { Dialog } from "../Dialog";
import { useBoardStore } from "../../store/boardStore";

export type SaveFlowKind = "copy" | "images";
/** Exceptional recovery/legacy image consent only. Normal editing saves automatically. */
export function SaveFlow({ kind, session, imageCount, close }: {
  kind: SaveFlowKind; session: AccountBoardSession; imageCount: number; close: () => void;
}) {
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [sourceId] = useState(() => useBoardStore.getState().id);
  const state = session.getState();
  const title = kind === "images" ? "Allow image upload" : "Save a copy";
  const changedBoard = sourceId !== useBoardStore.getState().id;
  return <Dialog open title={title} close={close}>
    <p>{kind === "images" ? "Upload this board’s pending images, then save the document to your account." : "Create a separate account copy for cross-device access and sharing. Your source board is kept."}</p>
    {imageCount > 0 && <p>{imageCount} {imageCount === 1 ? "image" : "images"} will be uploaded. Cloud images support JPEG, PNG and WebP up to 5 MiB each.</p>}
    {state.imageUpload && <p role="status">Uploading images… {state.imageUpload.completed}/{state.imageUpload.total}</p>}
    {started && !finished && state.busy && !state.imageUpload && <p role="status">Preparing and saving your board…</p>}
    {finished && !state.error && <p role="status">{state.status === "saved" ? kind === "images" ? "Account board saved." : "Account copy is ready." : "Edits are still waiting to save. Check Save details."}</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {finished && state.error && <p>{changedBoard || kind === "images" ? "Keep this destination page open. Completed image uploads are retained; use Save details to retry this page’s save." : "Creation may have reached your account if the response was lost. Refresh My pages and inspect the result before creating another copy. The source page remains here."}</p>}
    <div className="dialog-actions">
      {!started && state.userId && <button type="button" className="primary-action" disabled={state.busy} onClick={async () => {
        setStarted(true);
        if (kind === "images") await session.uploadImages(); else await session.saveCopy();
        setFinished(true);
      }}>{title}</button>}
      {started && state.busy && <button type="button" onClick={session.cancelOperation}>Stop request</button>}
      <button type="button" onClick={close}>{finished ? "Done" : started ? "Close" : "Cancel"}</button>
    </div>
    {started && <p className="dialog-footnote">Closing keeps the request running. Stopping does not undo completed uploads or confirmed account changes. The server may still finish its current upload; wait before retrying if it reports a limit.</p>}
  </Dialog>;
}
