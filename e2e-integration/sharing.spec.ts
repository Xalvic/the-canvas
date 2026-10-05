import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASE_URL, canvasState, connected, contextPage, editNote, flushLocalDraft, mutationHeaders, openBoard, signIn, state } from "./fixture";

test("actual invitation and acceptance grant editing; owner downgrade/removal preserve the editor's local recovery draft", async ({ page, context, browser }) => {
  await signIn(context.request);
  const title = `Invited-${randomUUID()}`;
  const editorSubject = `invited-${randomUUID()}`;
  const editorEmail = `${editorSubject}@example.com`;
  const create = await context.request.post(`${BASE_URL}/api/boards`, { headers: mutationHeaders, data: { title } });
  expect(create.status()).toBe(201);
  const boardId = (await create.json()).board.id as string;
  expect((await context.request.put(`${BASE_URL}/api/boards/${boardId}/document`, {
    headers: mutationHeaders, data: { schemaVersion: 1, expectedRevision: 0, content: { objects: [
      { id: "invited-note", type: "card", title: "Shared baseline", body: "", x: -340, y: -180, width: 260, height: 150, zIndex: 1, createdAt: 1, updatedAt: 1 },
    ] } },
  })).status()).toBe(201);
  await page.goto("/scribble/");
  await openBoard(page, title);
  const boardRow = page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
  await boardRow.getByRole("button", { name: "Share", exact: true }).click();
  const sharing = page.getByRole("region", { name: `Sharing ${title}`, exact: true });
  await sharing.getByLabel("Google email", { exact: true }).fill(editorEmail);
  await sharing.getByLabel("Invite role").selectOption("editor");
  await sharing.getByRole("button", { name: "Create invitation", exact: true }).click();
  await expect(sharing.getByRole("button", { name: "Copy invitation link", exact: true })).toBeVisible();

  // Identity is the sole test fixture: a verified Google account creates a real
  // DB session cookie. Invitation, membership and edits all use actual routes.
  const editorContext = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  try {
    const { page: editor, account } = await contextPage(editorContext, editorSubject);
    const inbox = editor.getByRole("region", { name: "Invitations", exact: true });
    await expect(inbox.getByText(title, { exact: true })).toBeVisible();
    expect((await editorContext.request.get(`${BASE_URL}/api/boards/${boardId}/document`)).status()).toBe(404);
    await inbox.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await openBoard(editor, title);
    await Promise.all([connected(page), connected(editor)]);
    await editNote(editor, "Shared baseline", "Shared editor save");
    await expect.poll(async () => (await state(context.request, boardId)).document!.content.objects[0]).toMatchObject({ title: "Shared editor save" });
    await expect.poll(async () => (await canvasState(page)).objects[0]).toMatchObject({ title: "Shared editor save" });

    await editorContext.setOffline(true);
    await editNote(editor, "Shared editor save", "Private draft after invitation");
    await flushLocalDraft(editor);
    await sharing.getByRole("button", { name: "Close sharing", exact: true }).click();
    await boardRow.getByRole("button", { name: "Share", exact: true }).click();
    await sharing.getByLabel(`Role for ${editorEmail}`, { exact: true }).selectOption("viewer");
    await expect(sharing.getByLabel(`Role for ${editorEmail}`, { exact: true })).toBeEnabled();
    await expect(sharing.getByLabel(`Role for ${editorEmail}`, { exact: true })).toHaveValue("viewer");
    await editorContext.setOffline(false);
    await expect(editor.getByText("Viewer access. This board is read-only.", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(editor.getByRole("button", { name: "Note tool", exact: true })).toBeDisabled();
    expect((await canvasState(editor)).objects[0]).toMatchObject({ title: "Private draft after invitation" });
    const beforeRemoval = await state(context.request, boardId);
    const savedObject = beforeRemoval.document!.content.objects[0]!;
    expect((await editorContext.request.post(`${BASE_URL}/api/boards/${boardId}/operations`, {
      headers: mutationHeaders, data: { operationId: randomUUID(), baseRevision: beforeRemoval.document!.revision,
        changes: [{ id: savedObject.id, before: savedObject, after: { ...savedObject, title: "Forbidden viewer write" } }] },
    })).status()).toBe(403);
    expect((await editorContext.request.get(`${BASE_URL}/api/boards/${boardId}/document`)).status()).toBe(200);

    page.once("dialog", (dialog) => dialog.accept());
    await sharing.locator(".sharing-person").filter({ has: page.getByLabel(`Role for ${editorEmail}`, { exact: true }) })
      .getByRole("button", { name: "Remove access", exact: true }).click();
    await expect(sharing.getByLabel(`Role for ${editorEmail}`, { exact: true })).toHaveCount(0);
    await expect(editor.getByText("Access removed. This local draft is read-only.", { exact: true })).toBeVisible({ timeout: 10_000 });
    expect((await editorContext.request.get(`${BASE_URL}/api/boards/${boardId}/document`)).status()).toBe(404);
    expect((await canvasState(editor)).objects[0]).toMatchObject({ title: "Private draft after invitation" });
    await flushLocalDraft(editor);
    const persisted = await editor.evaluate(async ({ userId, boardId }) => {
      const { accountBoardStorageId, loadLocalBoard } = await import(/* @vite-ignore */ "/scribble/src/persistence/localBoardStorage.ts");
      return loadLocalBoard(accountBoardStorageId(userId, boardId));
    }, { userId: account.user.id, boardId });
    expect(persisted?.objects["invited-note"]).toMatchObject({ title: "Private draft after invitation" });
    const afterRemoval = await state(context.request, boardId);
    expect(afterRemoval.document).toEqual(beforeRemoval.document);
    expect(afterRemoval.receipts).toEqual(beforeRemoval.receipts);
  } finally {
    await editorContext.setOffline(false);
    await editorContext.close();
  }
});
