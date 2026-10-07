import { z } from "zod";
import { getAsset } from "../assets/assetStore";
import { getBoardAssetUpload, uploadBoardAssetRequest, MAX_CLOUD_IMAGE_BYTES } from "../api/assets";
import { BoardApiError, createServerPage, getServerBoard, getServerBoardDocument } from "../api/boards";
import { applyBoardOperation } from "../api/collaboration";
import { collaborationOperationSchema } from "../../server/contracts/collaboration";
import { BOARD_STORE_NAME, openCanvasDatabase, requestResult } from "./database";
import { parseLocalBoard, type LocalBoardRecord } from "./localBoardStorage";
import { serializeDocumentSnapshot } from "./canvasDocumentAdapters";

const prefix = "guest-transfer:";
const tabKey = "scribble:guest-transfer-flow";
const intentSchema = z.object({
  version: z.literal(1), id: z.string().startsWith(prefix), flowId: z.uuid(),
  createdAt: z.number().finite(), authUntil: z.number().finite(),
  accountId: z.uuid().nullable(), status: z.enum(["awaiting-auth", "active", "paused", "committed", "complete"]),
  requestId: z.uuid(), destinationId: z.uuid().nullable(),
  source: z.custom<LocalBoardRecord>((value) => !!parseLocalBoard(value) && !(value as LocalBoardRecord).account),
  images: z.array(z.object({ localId: z.string(), requestId: z.uuid(), blob: z.instanceof(Blob),
    assetId: z.uuid().nullable(), dispatched: z.boolean(), pendingConfirmed: z.boolean().default(false), nextAttemptAt: z.number().finite(), canRetry: z.boolean() })),
  operation: collaborationOperationSchema.nullable(),
}).refine((intent) => intent.id === `${prefix}${intent.flowId}` &&
  (!["active", "committed", "complete"].includes(intent.status) || intent.accountId !== null), "Invalid transfer identity");
export type GuestTransferIntent = z.output<typeof intentSchema>;
export type GuestTransferSummary = Pick<GuestTransferIntent, "id" | "status" | "destinationId">;

export async function readGuestTransfer(id: string): Promise<GuestTransferIntent | null> {
  const db = await openCanvasDatabase();
  const raw: unknown = await requestResult(db.transaction(BOARD_STORE_NAME).objectStore(BOARD_STORE_NAME).get(id));
  return raw === undefined ? null : intentSchema.parse(raw);
}

// Separate namespaced records in the existing v4 store. Never write current-board,
// editor journals or live objects. Each mutation reads current state in its IDB transaction.
async function change(id: string, update: (current: GuestTransferIntent | null) => GuestTransferIntent) {
  const db = await openCanvasDatabase();
  return new Promise<GuestTransferIntent>((resolve, reject) => {
    const tx = db.transaction(BOARD_STORE_NAME, "readwrite"), store = tx.objectStore(BOARD_STORE_NAME);
    let result: GuestTransferIntent;
    const read = store.get(id);
    read.onsuccess = () => {
      try { result = intentSchema.parse(update(read.result === undefined ? null : intentSchema.parse(read.result))); store.put(result); }
      catch (error) { reject(error); tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Couldn’t preserve the drawing transfer on this device."));
  });
}

async function pendingForAccount(accountId: string) {
  const db = await openCanvasDatabase();
  const raw: unknown[] = await requestResult(db.transaction(BOARD_STORE_NAME).objectStore(BOARD_STORE_NAME)
    .getAll(IDBKeyRange.bound(prefix, `${prefix}\uffff`)));
  return raw.map((value) => intentSchema.parse(value)).filter((intent) => intent.accountId === accountId && intent.status !== "complete")
    .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

export class GuestTransfer {
  intent: GuestTransferIntent | null = null;
  private failedAuth = new URL(window.location.href).searchParams.has("authError");

  async stage(source: LocalBoardRecord, accountId: string | null, signal: AbortSignal) {
    signal.throwIfAborted();
    const snapshot = structuredClone(source);
    delete snapshot.account;
    if (!Object.keys(snapshot.objects).length) throw new Error("There’s no drawing to bring into your workspace.");
    const images: GuestTransferIntent["images"] = [];
    for (const object of Object.values(snapshot.objects)) {
      if (object.type !== "image" || images.some((image) => image.localId === object.assetId)) continue;
      const blob = await getAsset(object.assetId);
      signal.throwIfAborted();
      if (!blob || !["image/jpeg", "image/png", "image/webp"].includes(blob.type) || blob.size < 1 || blob.size > MAX_CLOUD_IMAGE_BYTES)
        throw new Error("Restore any missing images as JPEG, PNG or WebP files up to 5 MiB before bringing this drawing. The original stays on this device.");
      images.push({ localId: object.assetId, requestId: crypto.randomUUID(), blob, assetId: null, dispatched: false, pendingConfirmed: false, nextAttemptAt: 0, canRetry: true });
    }
    // Validate every supported object before OAuth or destination creation.
    serializeDocumentSnapshot(snapshot.objects, { boardId: crypto.randomUUID(),
      imageAssets: Object.fromEntries(images.map((image) => [image.localId, crypto.randomUUID()])) });
    const flowId = crypto.randomUUID(), id = `${prefix}${flowId}`;
    const intent: GuestTransferIntent = { version: 1, id, flowId, createdAt: Date.now(), authUntil: Date.now() + 10 * 60_000,
      accountId, status: accountId ? "active" : "awaiting-auth", requestId: crypto.randomUUID(), destinationId: null,
      source: snapshot, images, operation: null };
    signal.throwIfAborted();
    this.intent = await change(id, () => intent);
    signal.throwIfAborted();
    if (!accountId) sessionStorage.setItem(tabKey, flowId); // Failure blocks OAuth; no undiscoverable consent.
    return flowId;
  }

  async authentication(accountId: string | null, signal: AbortSignal) {
    const url = new URL(window.location.href);
    const flowId = url.searchParams.get("authFlow"), failed = this.failedAuth || url.searchParams.has("authError");
    let tabFlow: string | null = null;
    try { tabFlow = sessionStorage.getItem(tabKey); } catch { /* Guest/account reads need no transfer consent storage. */ }
    const awaiting = tabFlow ? await readGuestTransfer(`${prefix}${tabFlow}`) : null;
    signal.throwIfAborted();
    if (awaiting?.status === "awaiting-auth" && (failed || flowId && flowId === tabFlow)) {
      this.intent = await change(awaiting.id, (current) => {
        if (!current || current.status !== "awaiting-auth") return current ?? awaiting;
        return { ...current, accountId: !failed && accountId && Date.now() <= current.authUntil ? accountId : null,
          status: !failed && accountId && Date.now() <= current.authUntil ? "active" : "paused" };
      });
      sessionStorage.removeItem(tabKey);
    }
    this.failedAuth = false;
    if (flowId) { url.searchParams.delete("authFlow"); window.history.replaceState(window.history.state, "", url.href); }
    signal.throwIfAborted();
    this.intent = accountId ? await pendingForAccount(accountId) : null;
    signal.throwIfAborted();
    return this.intent;
  }

  async declineAuthentication() {
    let flowId: string | null = null;
    try { flowId = sessionStorage.getItem(tabKey); } catch { return; }
    if (flowId) {
      const old = await readGuestTransfer(`${prefix}${flowId}`);
      if (old?.status === "awaiting-auth") await change(old.id, (current) => ({ ...current!, status: "paused" }));
    }
    sessionStorage.removeItem(tabKey);
    this.intent = null;
  }

  async pause() {
    if (this.intent && !["complete", "committed"].includes(this.intent.status)) this.intent = await change(this.intent.id, (current) => ({ ...current!, status: "paused" }));
  }

  async activate(accountId: string) {
    if (!this.intent || this.intent.accountId !== accountId) throw new Error("Resume this drawing with the account that started its transfer.");
    this.intent = await change(this.intent.id, (current) => ({ ...current!, status: ["complete", "committed"].includes(current!.status) ? current!.status : "active" }));
  }

  async opened() {
    if (this.intent?.status === "committed") this.intent = await change(this.intent.id, (current) => ({ ...current!, status: "complete" }));
  }

  async resume(accountId: string, signal: AbortSignal, progress: (message: string) => void) {
    const id = this.intent?.id;
    if (!id) throw new Error("Choose a drawing to bring into your workspace first.");
    const run = async () => {
      const save = async (update: (current: GuestTransferIntent) => GuestTransferIntent) => {
        signal.throwIfAborted();
        this.intent = await change(id, (current) => {
          signal.throwIfAborted();
          if (!current || current.accountId !== accountId || !["active", "committed", "complete"].includes(current.status))
            throw new Error("Drawing transfer paused. Your original stays on this device.");
          return update(current);
        });
        return this.intent;
      };
      const refresh = async () => {
        signal.throwIfAborted();
        const intent = await readGuestTransfer(id);
        signal.throwIfAborted();
        if (!intent || intent.accountId !== accountId || !["active", "committed", "complete"].includes(intent.status)) throw new Error("Drawing transfer paused. Your original stays on this device.");
        this.intent = intent;
        return intent;
      };
      let intent = await refresh();
      if (!intent.destinationId) {
        progress("Creating a page for your drawing…");
        const result = await createServerPage({ title: intent.source.title.trim().slice(0, 120) || "Untitled", requestId: intent.requestId, initializeDocument: true }, signal, accountId);
        await refresh();
        await save((current) => ({ ...current, destinationId: result.board.id }));
        intent = await refresh();
      }
      const destinationId = intent.destinationId!;
      if (["complete", "committed"].includes(intent.status)) return destinationId;
      // Always verify current access/document before preparing a recovered destination.
      await getServerBoard(destinationId, signal, accountId);
      const remote = await getServerBoardDocument(destinationId, signal, accountId);
      await refresh();
      if (!intent.operation && (remote.revision !== 1 || remote.content.objects.length))
        throw new Error("This destination was edited before the transfer finished. Your source is preserved; the transfer won’t replace those edits.");
      for (let index = 0; index < intent.images.length; index++) {
        intent = await refresh();
        let image = intent.images[index];
        if (image.assetId) continue;
        progress(`Bringing images… ${index + 1}/${intent.images.length}`);
        let upload;
        if (image.dispatched) {
          try { upload = await getBoardAssetUpload(destinationId, image.requestId, signal, accountId); }
          catch (error) { if (!(error instanceof BoardApiError && error.code === "ASSET_UPLOAD_NOT_FOUND")) throw error; }
        }
        if (!upload || upload.state === "pending" && upload.canRetry && image.pendingConfirmed && Date.now() >= image.nextAttemptAt) {
          if (!image.canRetry || Date.now() < image.nextAttemptAt) throw new Error("Image upload is still being checked. Retry the transfer shortly; its original request is retained.");
          await refresh();
          await save((current) => ({ ...current, images: current.images.map((value, i) => i === index
            ? { ...value, dispatched: true, nextAttemptAt: Date.now() + 5_000 } : value) }));
          try { upload = await uploadBoardAssetRequest(destinationId, image.blob, image.requestId, signal, accountId); }
          catch (error) {
            if (error instanceof BoardApiError && error.retryAfterMs) await save((current) => ({ ...current,
              images: current.images.map((value, i) => i === index ? { ...value, nextAttemptAt: Date.now() + error.retryAfterMs! } : value) }));
            throw error;
          }
        }
        await refresh();
        await save((current) => ({ ...current, images: current.images.map((value, i) => i === index
          ? { ...value, assetId: upload!.state === "ready" ? upload!.assetId : null, canRetry: upload!.canRetry, pendingConfirmed: upload!.state === "pending",
            nextAttemptAt: Date.now() + (upload!.retryAfterMs ?? 0) } : value) }));
        image = this.intent!.images[index];
        if (!image.assetId) throw new Error(upload.state === "failed" ? "This image upload expired. The drawing and images remain on this device."
          : "Image upload is still being checked. Retry the transfer shortly; its original request is retained.");
      }
      intent = await refresh();
      if (!intent.operation) {
        const document = serializeDocumentSnapshot(intent.source.objects, { boardId: destinationId,
          imageAssets: Object.fromEntries(intent.images.map((image) => [image.localId, image.assetId!])) });
        const operation = collaborationOperationSchema.parse({ operationId: crypto.randomUUID(), baseRevision: 1,
          changes: document.content.objects.map((object) => ({ id: object.id, before: null, after: object })) });
        await save((current) => ({ ...current, operation: current.operation ?? operation }));
        intent = await refresh();
      }
      progress("Confirming your drawing…");
      // Durable operation receipts acknowledge a lost response without replaying an
      // initial snapshot over newer edits. The identical operation is safe to retry.
      await applyBoardOperation(destinationId, intent.operation!, signal, accountId);
      await refresh();
      await save((current) => ({ ...current, status: current.status === "complete" ? "complete" : "committed" }));
      return destinationId;
    };
    // Serialize this intent across tabs when supported. Server receipts/CAS still
    // protect every create/upload/document request if a browser lacks Web Locks.
    return typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(id, { signal }, run) : run();
  }
}
