import { closeDialogs, details, explicitSave } from "../e2e/fixtures/ui";
import { randomUUID } from "node:crypto";
import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { BASE_URL, canvasState, connected, contextPage, createNote, editNote, flushLocalDraft, membership, mutationHeaders, network, openBoard, signIn, state } from "./fixture";

type SharedBoard = { boardId: string; title: string; ownerId: string; editorId: string; editorContext: BrowserContext; editor: Page };
const test = base.extend<{ shared: SharedBoard }>({
  shared: async ({ page, context, browser }, use) => {
    const owner = await signIn(context.request);
    const title = `Shared-${randomUUID()}`;
    const create = await context.request.post(`${BASE_URL}/api/boards`, { headers: mutationHeaders, data: { title } });
    expect(create.status()).toBe(201);
    const boardId = (await create.json()).board.id as string;
    const objects = [
      { id: "owner-note", type: "card", title: "Owner baseline", body: "", x: -340, y: -180, width: 260, height: 150, zIndex: 1, createdAt: 1, updatedAt: 1 },
      { id: "editor-note", type: "card", title: "Editor baseline", body: "", x: 40, y: -180, width: 260, height: 150, zIndex: 2, createdAt: 1, updatedAt: 1 },
    ];
    expect((await context.request.put(`${BASE_URL}/api/boards/${boardId}/document`, {
      headers: mutationHeaders, data: { schemaVersion: 1, expectedRevision: 0, content: { objects } },
    })).status()).toBe(201);
    const editorContext = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    try {
      const { page: editor, account } = await contextPage(editorContext);
      await membership(context.request, boardId, account.user.id, "editor");
      await Promise.all([page.goto("/scribble/"), editor.reload()]);
      await Promise.all([openBoard(page, title), openBoard(editor, title)]);
      await Promise.all([connected(page), connected(editor)]);
      await use({ boardId, title, ownerId: owner.user.id, editorId: account.user.id, editorContext, editor });
    } finally {
      await editorContext.setOffline(false);
      await network(context.request);
      await editorContext.close();
    }
  },
});

function titles(objects: Awaited<ReturnType<typeof canvasState>>["objects"] | NonNullable<Awaited<ReturnType<typeof state>>["document"]>["content"]["objects"]) {
  return objects.filter((object) => object.type === "card").map((object) => object.title).sort();
}
async function savedTitles(request: Parameters<typeof state>[0], boardId: string) {
  return titles((await state(request, boardId)).document!.content.objects);
}

test("two actual browsers retain simultaneous creates and different-object edits; undo preserves the collaborator's changes", async ({ page, context, shared }) => {
  const { editor, boardId } = shared;
  await Promise.all([createNote(page, "Owner created", 400, 610), createNote(editor, "Editor created", 790, 610)]);
  const created = ["Owner baseline", "Editor baseline", "Owner created", "Editor created"].sort();
  await expect.poll(() => savedTitles(context.request, boardId), { timeout: 12_000 }).toEqual(created);
  await expect.poll(async () => titles((await canvasState(page)).objects)).toEqual(created);
  await expect.poll(async () => titles((await canvasState(editor)).objects)).toEqual(created);
  await Promise.all([editNote(page, "Owner baseline", "Owner edited"), editNote(editor, "Editor baseline", "Editor edited")]);
  const edited = ["Owner edited", "Editor edited", "Owner created", "Editor created"].sort();
  await expect.poll(() => savedTitles(context.request, boardId), { timeout: 12_000 }).toEqual(edited);
  await expect.poll(async () => titles((await canvasState(page)).objects)).toEqual(edited);
  await page.getByRole("button", { name: /^Undo / }).click();
  const undone = ["Owner baseline", "Editor edited", "Owner created", "Editor created"].sort();
  await expect.poll(() => savedTitles(context.request, boardId), { timeout: 12_000 }).toEqual(undone);
  await expect.poll(async () => titles((await canvasState(editor)).objects)).toEqual(undone);
  expect((await state(context.request, boardId)).receipts.length).toBeGreaterThanOrEqual(5);
});

test("same-object concurrent conflict preserves the offline draft and save-as-new creates a separate recovery board", async ({ page, context, shared }) => {
  const { editor, editorContext, boardId } = shared;
  await editorContext.setOffline(true);
  await editNote(editor, "Owner baseline", "My conflicting draft");
  await flushLocalDraft(editor);
  await editNote(page, "Owner baseline", "Owner remote update");
  await expect.poll(() => savedTitles(context.request, boardId), { timeout: 12_000 }).toEqual(["Editor baseline", "Owner remote update"].sort());
  await editorContext.setOffline(false);
  await expect(editor.locator(".save-status")).toContainText("Account save failed");
  await details(editor);
  await editor.getByRole("button", { name: "Retry account save", exact: true }).click();
  await closeDialogs(editor);
  await expect(editor.locator(".save-status")).toHaveText("This board changed elsewhere");
  expect(titles((await canvasState(editor)).objects)).toContain("My conflicting draft");
  await explicitSave(editor, "Save a copy");
  await expect.poll(async () => (await canvasState(editor)).account?.boardId).not.toBe(boardId);
  await expect(editor.locator(".save-status")).toHaveText("Saved to account");
  const copyId = (await canvasState(editor)).account!.boardId;
  expect(await savedTitles(context.request, copyId)).toEqual(["Editor baseline", "My conflicting draft"].sort());
  expect(await savedTitles(context.request, boardId)).toEqual(["Editor baseline", "Owner remote update"].sort());
});

test("remote presence carries world coordinates and selections across independent pan and zoom", async ({ page, shared }) => {
  const { editor, ownerId } = shared;
  await page.evaluate(async () => {
    const { useViewportStore } = await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts");
    useViewportStore.getState().setViewport({ x: 150, y: 100, zoom: 2 });
    const { useSelectionStore } = await import(/* @vite-ignore */ "/scribble/src/store/selectionStore.ts");
    useSelectionStore.getState().selectOnly("owner-note");
  });
  await editor.evaluate(async () => {
    const { useViewportStore } = await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts");
    useViewportStore.getState().setViewport({ x: 400, y: 200, zoom: .75 });
  });
  await page.mouse.move(550, 400);
  await expect.poll(() => editor.evaluate(async (userId) => {
    const { useCollaborationStore } = await import(/* @vite-ignore */ "/scribble/src/store/collaborationStore.ts");
    return useCollaborationStore.getState().participants.find((participant) => participant.userId === userId)?.cursor;
  }, ownerId), { timeout: 8000 }).toEqual({ x: 200, y: 150 });
  const remoteClient = await editor.evaluate(async (userId) => {
    const { useCollaborationStore } = await import(/* @vite-ignore */ "/scribble/src/store/collaborationStore.ts");
    return useCollaborationStore.getState().participants.find((participant) => participant.userId === userId);
  }, ownerId);
  expect(remoteClient?.selectedIds).toEqual(["owner-note"]);
  const cursor = editor.locator(`[data-collaboration-client="${remoteClient!.clientId}"] [data-collaboration-cursor="true"]`);
  await expect(cursor).toBeInViewport();
  const box = await cursor.boundingBox();
  expect(box!.x).toBeCloseTo(550, 0);
  expect(box!.y).toBeCloseTo(312.5, 0);
});

test("offline independent edits reconnect through fresh reads and compare-and-swap without overwriting the other browser", async ({ page, context, shared }) => {
  const { editor, editorContext, boardId } = shared;
  await editorContext.setOffline(true);
  await editNote(editor, "Editor baseline", "Editor offline edit");
  await flushLocalDraft(editor);
  await editNote(page, "Owner baseline", "Owner while offline");
  await expect.poll(() => savedTitles(context.request, boardId), { timeout: 12_000 }).toEqual(["Editor baseline", "Owner while offline"].sort());
  await editorContext.setOffline(false);
  await expect(editor.locator(".save-status")).toContainText("Account save failed");
  await details(editor);
  await editor.getByRole("button", { name: "Retry account save", exact: true }).click();
  await closeDialogs(editor);
  const merged = ["Editor offline edit", "Owner while offline"].sort();
  await expect.poll(() => savedTitles(context.request, boardId), { timeout: 12_000 }).toEqual(merged);
  await expect.poll(async () => titles((await canvasState(editor)).objects)).toEqual(merged);
  await expect.poll(async () => titles((await canvasState(page)).objects)).toEqual(merged);
  await connected(editor);
});

test("a committed operation with a lost response survives reload and replays exactly once", async ({ page, context, shared }) => {
  const { boardId, title, ownerId } = shared;
  const before = (await state(context.request, boardId)).document!.revision;
  await network(context.request, 1);
  await editNote(page, "Owner baseline", "Committed despite lost response");
  await expect.poll(() => savedTitles(context.request, boardId), { timeout: 12_000 }).toContain("Committed despite lost response");
  await expect(page.locator(".save-status")).toContainText("Account save failed");
  await flushLocalDraft(page);
  expect((await state(context.request, boardId)).receipts.filter((receipt) => receipt.actor_id === ownerId)).toHaveLength(1);
  await page.reload(); await openBoard(page, title);
  await details(page);
  const retry = page.getByRole("button", { name: "Retry account save", exact: true });
  if (await retry.isVisible()) await retry.click();
  await closeDialogs(page);
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  const after = await state(context.request, boardId);
  expect(after.document!.revision).toBe(before + 1);
  expect(after.receipts.filter((receipt) => receipt.actor_id === ownerId)).toHaveLength(1);
  expect(titles((await canvasState(page)).objects)).toContain("Committed despite lost response");
});

test("live downgrade and revocation block new writes and fresh reads while retaining the editor's draft", async ({ context, shared }) => {
  const { editor, editorContext, boardId, editorId } = shared;
  await editorContext.setOffline(true);
  await editNote(editor, "Editor baseline", "Private recoverable draft");
  await flushLocalDraft(editor);
  await membership(context.request, boardId, editorId, "viewer");
  await editorContext.setOffline(false);
  await expect(editor.locator(".save-status")).toHaveText("Can view · account board", { timeout: 10_000 });
  expect(titles((await canvasState(editor)).objects)).toContain("Private recoverable draft");
  await expect(editor.getByRole("button", { name: "Note tool", exact: true })).toBeDisabled();
  const snapshot = await state(context.request, boardId);
  const first = snapshot.document!.content.objects[0];
  expect((await editorContext.request.post(`${BASE_URL}/api/boards/${boardId}/operations`, {
    headers: mutationHeaders, data: { operationId: randomUUID(), baseRevision: snapshot.document!.revision, changes: [{ id: first.id, before: first, after: first }] },
  })).status()).toBe(403);
  expect((await editorContext.request.get(`${BASE_URL}/api/boards/${boardId}/document`)).status()).toBe(200);
  await membership(context.request, boardId, editorId, null);
  await expect(editor.locator(".save-status")).toHaveText("Access removed", { timeout: 10_000 });
  expect((await editorContext.request.get(`${BASE_URL}/api/boards/${boardId}/document`)).status()).toBe(404);
  expect(titles((await canvasState(editor)).objects)).toContain("Private recoverable draft");
  expect((await state(context.request, boardId)).document!.revision).toBe(snapshot.document!.revision);
});
