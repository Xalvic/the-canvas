import { browse, closeDialogs, details, accountMenu, backToDevice, newAccountBoard, explicitSave, rowActions } from "./fixtures/ui";
import { expect, test } from "@playwright/test";
import { user, firstId, secondId, savedBoard, mockAccount, canvasState, localBoard, createNote, editNote, openBoard, documentWrites } from "./fixtures/account";

test("viewers can navigate and copy but cannot change the canvas, title or history", async ({ page }) => {
  const board = savedBoard(firstId, "Viewer drawing"); board.role = "viewer"; board.document!.role = "viewer";
  const cloud = await mockAccount(page, [board]);
  await page.goto("/scribble/"); await backToDevice(page); await openBoard(page, board.title);
  await expect(page.locator(".save-status")).toHaveText("Can view · account board");
  await expect(page.getByLabel("Board title")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Note tool", exact: true })).toBeDisabled();
  const before = await canvasState(page);
  await page.mouse.dblclick(600, 500);
  await page.keyboard.press("n"); await page.mouse.click(610, 510);
  await page.mouse.move(350, 490); await page.mouse.down(); await page.mouse.move(450, 540); await page.mouse.up();
  await page.keyboard.press("Control+c");
  const copied = await page.evaluate(async () => {
    const { useClipboardStore } = await import(/* @vite-ignore */ "/scribble/src/store/clipboardStore.ts");
    return useClipboardStore.getState().objects;
  });
  expect(copied).toHaveLength(1);
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Delete"); await page.keyboard.press("Control+d"); await page.keyboard.press("Control+z");
  const after = await canvasState(page);
  expect(after.objects).toEqual(before.objects); expect(after.past).toEqual(before.past); expect(after.future).toEqual(before.future);
  expect(cloud.mutations).toEqual([]);
  const row = page.getByRole("listitem").filter({ has: page.getByText(board.title, { exact: true }) });
  await browse(page, "Shared with me");
  await expect(row.getByRole("button", { name: "Rename", exact: true })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
  await backToDevice(page);
  await createNote(page, "Guest still editable");
});

test("editors save changes and a later downgrade stops edits while retaining the local draft", async ({ page }) => {
  const board = savedBoard(firstId, "Editor drawing"); board.role = "editor"; board.document!.role = "editor";
  const cloud = await mockAccount(page, [board]);
  await page.goto("/scribble/"); await backToDevice(page); await openBoard(page, board.title);
  await expect(page.getByLabel("Board title")).toBeEnabled();
  await editNote(page, board.title, "Editor saved this");
  await expect.poll(() => documentWrites(cloud).length).toBe(1);
  await page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    useDocumentStore.getState().updateObject(Object.keys(useDocumentStore.getState().objects)[0], { body: "Unsent draft" });
  });
  const current = cloud.boards.get(firstId)!; current.role = "viewer"; current.document!.role = "viewer";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Board title")).toBeDisabled();
  await page.waitForTimeout(800);
  expect(documentWrites(cloud)).toHaveLength(1);
  expect(Object.values((await canvasState(page)).objects)[0]).toMatchObject({ body: "Unsent draft" });
  cloud.boards.delete(firstId);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".save-status")).toHaveText("Access removed");
});

test("owners create link invitations, change roles and remove members", async ({ page }) => {
  await mockAccount(page, [savedBoard(firstId, "Owner drawing")]);
  const sharing = { members: [{ userId: secondId, email: "member@example.com", displayName: "Member", role: "viewer" }], invitations: [] as { id: string; email: string; role: string; expiresAt: number }[] };
  await page.route(/\/api\/boards\/[^/]+\/(sharing|invitations|members)(\/[^/]+)?$/, async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() === "GET") { await route.fulfill({ json: sharing }); return; }
    expect(req.headers()["x-scribble-request"]).toBe("1");
    if (req.method() === "POST") {
      const invitation = { id: "44444444-4444-4444-8444-444444444444", ...req.postDataJSON(), expiresAt: Date.now() + 86400000 };
      sharing.invitations.push(invitation); await route.fulfill({ status: 201, json: { invitation } }); return;
    }
    if (req.method() === "PATCH") sharing.members[0].role = req.postDataJSON().role;
    else if (path.includes("/members/")) sharing.members = [];
    else sharing.invitations = [];
    await route.fulfill({ status: 204 });
  });
  await page.goto("/scribble/"); await backToDevice(page); await rowActions(page, "Owner drawing"); await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByLabel("Google email").fill("friend@example.com");
  await page.getByLabel("Invite role").selectOption("editor");
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  await expect(page.getByText(/friend@example.com · editor/)).toBeVisible();
  await page.getByRole("button", { name: "Copy invitation link", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /Invitation link copied|Clipboard unavailable/ })).toBeVisible();
  await page.getByLabel("Role for member@example.com").selectOption("editor");
  await expect.poll(() => sharing.members[0].role).toBe("editor");
  await page.getByRole("button", { name: "Remove access", exact: true }).click();
  await page.getByRole("button", { name: "Confirm removal", exact: true }).click();
  await expect(page.getByText("No invited members yet.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel invitation", exact: true }).click();
  await expect(page.getByText("No pending invitations.", { exact: true })).toBeVisible();
});

test("recipients explicitly accept an invitation before its shared board appears", async ({ page }) => {
  const cloud = await mockAccount(page);
  const id = "44444444-4444-4444-8444-444444444444";
  let pending = true;
  await page.route("**/api/invitations", (route) => route.fulfill({ json: { invitations: pending ? [{ id, email: user.email, role: "viewer", expiresAt: Date.now() + 86400000, boardId: firstId, boardTitle: "Invited drawing", ownerEmail: "friend@example.com" }] : [] } }));
  await page.route(`**/api/invitations/${id}/accept`, (route) => {
    expect(route.request().headers()["x-scribble-request"]).toBe("1");
    pending = false; const board = savedBoard(firstId, "Invited drawing"); board.role = "viewer"; board.document!.role = "viewer"; cloud.boards.set(firstId, board);
    return route.fulfill({ json: { board } });
  });
  await page.goto(`/scribble/?invite=${id}`);
  await expect(page.getByRole("list", { name: "Boards from server" })).toHaveCount(0);
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await page.getByRole("button", { name: "Open board", exact: true }).click();
  await expect(page.getByLabel("Board title")).toBeDisabled();
  expect(cloud.mutations).toEqual([]);
});

test("signing in lists owned boards without uploading or changing guest IndexedDB", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Account sketch")]);
  cloud.signedIn = false;
  await page.goto("/scribble/"); await backToDevice(page);
  await page.getByLabel("Board title").fill("Guest sketch");
  await createNote(page, "Kept on this device");
  await expect.poll(async () => (await localBoard(page))?.title).toBe("Guest sketch");
  const guestBoard = await localBoard(page);
  cloud.signedIn = true;
  await page.reload(); await backToDevice(page);
  await browse(page);
  await expect(page.getByText("Account sketch", { exact: true })).toBeVisible();
  await closeDialogs(page);
  await expect(page.getByLabel("Board title")).toHaveValue("Guest sketch");
  expect((await canvasState(page)).objects).toEqual(guestBoard?.objects);
  expect(cloud.mutations).toEqual([]);
  expect(await localBoard(page)).toEqual(guestBoard);
});

test("explicit upload creates a copy, then saves committed edits with increasing revisions", async ({ page }) => {
  const cloud = await mockAccount(page);
  await page.goto("/scribble/"); await backToDevice(page);
  await page.getByLabel("Board title").fill("My local board");
  await createNote(page, "Local idea");
  const localObjects = (await canvasState(page)).objects;
  await explicitSave(page, "Save to account");
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  expect(cloud.mutations.filter((mutation) => mutation.method === "POST" && mutation.path === "/api/boards")).toHaveLength(1);
  expect(documentWrites(cloud)[0].body).toMatchObject({ expectedRevision: 0, schemaVersion: 1, content: { objects: Object.values(localObjects) } });
  const guestBoard = await localBoard(page);
  await page.getByText("Local idea", { exact: true }).dblclick();
  await page.getByLabel("Card title", { exact: true }).fill("Uncommitted note edit");
  await page.waitForTimeout(750);
  expect(documentWrites(cloud)).toHaveLength(1);
  await page.keyboard.press("Escape");
  await expect.poll(() => documentWrites(cloud).length).toBe(2);
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  expect(documentWrites(cloud)[1].body).toMatchObject({ baseRevision: 1, changes: [{ after: expect.objectContaining({ title: "Uncommitted note edit" }) }] });
  expect(await localBoard(page)).toEqual(guestBoard);
  await backToDevice(page);
  await expect(page.getByRole("button", { name: "Back to local board", exact: true })).toBeHidden();
  expect((await canvasState(page)).objects).toEqual(localObjects);
  await page.reload(); await backToDevice(page);
  await expect(page.getByLabel("Board title")).toHaveValue("My local board");
  expect((await canvasState(page)).objects).toEqual(localObjects);
});

test("opening and switching account boards restores guest objects, viewport and title without cloud writes", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "First account board"), savedBoard(secondId, "Second account board")]);
  await page.goto("/scribble/"); await backToDevice(page);
  await page.getByLabel("Board title").fill("Guest before opening");
  await createNote(page, "Guest note");
  await page.evaluate(async () => {
    const { useViewportStore } = await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts");
    useViewportStore.getState().setViewport({ x: 75, y: -30, zoom: 1.3 });
  });
  const guestState = await canvasState(page);
  await openBoard(page, "First account board");
  expect(Object.values((await canvasState(page)).objects)).toEqual(cloud.boards.get(firstId)?.document?.content.objects);
  expect((await canvasState(page)).past).toHaveLength(0);
  await openBoard(page, "Second account board");
  expect(Object.values((await canvasState(page)).objects)).toEqual(cloud.boards.get(secondId)?.document?.content.objects);
  await backToDevice(page);
  await expect(page.getByLabel("Board title")).toHaveValue("Guest before opening");
  const restored = await canvasState(page);
  expect(restored.objects).toEqual(guestState.objects);
  expect(restored.viewport).toEqual(guestState.viewport);
  const persisted = await localBoard(page);
  expect(persisted).toMatchObject({ title: "Guest before opening", objects: guestState.objects, viewport: guestState.viewport });
  expect(cloud.mutations).toEqual([]);
});

test("a conflict keeps a durable draft across reload and saves recovery only to a new board", async ({ page }) => {
  const cloud = await mockAccount(page, [
    savedBoard(firstId, "Shared between my devices"),
    savedBoard(secondId, "Weekly planning and architecture notes for my October project"),
  ]);
  await page.goto("/scribble/"); await backToDevice(page);
  await page.getByLabel("Board title").fill("Untouched guest");
  await openBoard(page, "Shared between my devices");
  cloud.conflictOnNextSave = true;
  await editNote(page, "Shared between my devices", "My conflicting draft");
  await expect(page.locator(".save-status")).toHaveText("This board changed elsewhere");
  const draftObjects = (await canvasState(page)).objects;
  expect(documentWrites(cloud)).toHaveLength(1);
  expect(documentWrites(cloud)[0].body.baseRevision).toBe(1);
  await page.evaluate(async () => {
    const { waitForLocalBoardSave } = await import(/* @vite-ignore */ "/scribble/src/persistence/waitForLocalBoardSave.ts");
    await waitForLocalBoardSave(new AbortController().signal);
  });
  await page.reload(); await backToDevice(page);
  await expect(page.getByLabel("Board title")).toHaveValue("Untouched guest");
  await openBoard(page, "Shared between my devices");
  await expect(page.locator(".save-status")).toHaveText("This board changed elsewhere");
  expect((await canvasState(page)).objects).toEqual(draftObjects);
  await page.waitForTimeout(1100); // Outlast the account debounce: reopening a conflict must not schedule a PUT.
  expect(documentWrites(cloud)).toHaveLength(1);
  await page.screenshot({ path: "test-results/account-boards-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/account-boards-mobile.png" });
  await page.setViewportSize({ width: 1360, height: 900 });
  await explicitSave(page, "Save a copy");
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  expect(cloud.mutations.filter((mutation) => mutation.method === "POST" && mutation.path === "/api/boards")).toHaveLength(1);
  expect(documentWrites(cloud)).toHaveLength(2);
  expect(documentWrites(cloud)[1]).toMatchObject({ body: { expectedRevision: 0, content: { objects: Object.values(draftObjects) } } });
  expect(documentWrites(cloud)[1].path).not.toBe(`/api/boards/${firstId}/document`);
  expect(cloud.boards.get(firstId)?.document?.content.objects[0]).toMatchObject({ title: "Changed on another device" });
});

test("reloading a conflicting account version preserves the previous draft for explicit restore", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Account original")]);
  await page.goto("/scribble/"); await backToDevice(page);
  await openBoard(page, "Account original");
  cloud.conflictOnNextSave = true;
  await editNote(page, "Account original", "Recoverable previous draft");
  await expect(page.locator(".save-status")).toHaveText("This board changed elsewhere");
  const draftObjects = (await canvasState(page)).objects;
  await details(page);
  await page.getByRole("button", { name: "Use account version", exact: true }).click();
  await page.getByRole("dialog", { name: "Use account version", exact: true }).getByRole("button", { name: "Use account version", exact: true }).click();
  await closeDialogs(page);
  await expect(page.getByText("Changed on another device", { exact: true })).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  await details(page);
  await page.getByRole("button", { name: "Restore previous draft", exact: true }).click();
  await closeDialogs(page);
  await expect(page.locator(".save-status")).toHaveText("This board changed elsewhere");
  expect((await canvasState(page)).objects).toEqual(draftObjects);
  expect(documentWrites(cloud)).toHaveLength(1);
});

test("images remain local and are rejected before account metadata is created", async ({ page }) => {
  const cloud = await mockAccount(page);
  await page.goto("/scribble/"); await backToDevice(page);
  await expect(page.getByLabel("Board title")).toBeEnabled();
  await page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    useDocumentStore.getState().addObject({ id: "local-image", type: "image", assetId: "image-asset", name: "Local image", x: 300, y: 450, width: 40, height: 40, originalWidth: 40, originalHeight: 40, zIndex: 1, createdAt: 1, updatedAt: 1 });
  });
  await explicitSave(page, "Save to account");
  await details(page);
  await expect(page.getByRole("alert").filter({ hasText: /image/i })).toBeVisible();
  await closeDialogs(page);
  expect(cloud.mutations).toEqual([]);
  await expect.poll(async () => (await localBoard(page))?.objects["local-image"]?.type).toBe("image");
  await page.reload(); await backToDevice(page);
  await expect(page.getByLabel("Board title")).toBeEnabled();
  expect((await canvasState(page)).objects["local-image"]).toMatchObject({ type: "image", assetId: "image-asset" });
});

test("an account draft containing an unsupported image is restored locally when reopened", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Account image draft")]);
  await page.goto("/scribble/"); await backToDevice(page);
  await page.getByLabel("Board title").fill("Guest before image draft");
  await openBoard(page, "Account image draft");
  await page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    useDocumentStore.getState().addObject({ id: "account-local-image", type: "image", assetId: "account-image-asset", name: "Image only on this device", x: 650, y: 450, width: 40, height: 40, originalWidth: 40, originalHeight: 40, zIndex: 2, createdAt: 1, updatedAt: 1 });
  });
  await expect(page.locator(".save-status")).toContainText("Account save failed");
  const draftObjects = (await canvasState(page)).objects;
  expect(documentWrites(cloud)).toHaveLength(0);
  await backToDevice(page);
  await expect(page.getByLabel("Board title")).toHaveValue("Guest before image draft");
  await openBoard(page, "Account image draft");
  expect((await canvasState(page)).objects).toEqual(draftObjects);
  await expect(page.locator(".save-status")).toContainText("Account save failed");
  expect(cloud.mutations).toEqual([]);
  await page.reload(); await backToDevice(page);
  await expect(page.getByLabel("Board title")).toHaveValue("Guest before image draft");
  await openBoard(page, "Account image draft");
  expect((await canvasState(page)).objects).toEqual(draftObjects);
  expect(cloud.mutations).toEqual([]);
});

test("an account save failure retains edits and retries the same expected revision", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Retry board")]);
  await page.goto("/scribble/"); await backToDevice(page);
  await openBoard(page, "Retry board");
  cloud.failSaves = true;
  await editNote(page, "Retry board", "Retry this draft");
  await expect(page.locator(".save-status")).toContainText("Account save failed");
  const draftObjects = (await canvasState(page)).objects;
  expect(documentWrites(cloud)).toHaveLength(1);
  cloud.failSaves = false;
  await details(page);
  await page.getByRole("button", { name: "Retry account save", exact: true }).click();
  await closeDialogs(page);
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  expect(documentWrites(cloud)).toHaveLength(2);
  expect(documentWrites(cloud).map((mutation) => mutation.body.baseRevision)).toEqual([1, 1]);
  expect(documentWrites(cloud)[0].body.operationId).toBe(documentWrites(cloud)[1].body.operationId);
  expect(cloud.boards.get(firstId)?.document?.content.objects).toEqual(Object.values(draftObjects));
});

test("session expiry during save returns to the guest board and keeps the private draft for later sign-in", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Expired-session board")]);
  await page.goto("/scribble/"); await backToDevice(page);
  await page.getByLabel("Board title").fill("Guest remains mine");
  await createNote(page, "Guest before expiry");
  const guestObjects = (await canvasState(page)).objects;
  await openBoard(page, "Expired-session board");
  cloud.signedIn = false;
  await editNote(page, "Expired-session board", "Private draft before expiry");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByLabel("Board title")).toHaveValue("Guest remains mine");
  expect((await canvasState(page)).objects).toEqual(guestObjects);
  await expect(page.getByText("Expired-session board", { exact: true })).toHaveCount(0);
  cloud.signedIn = true;
  await page.reload(); await backToDevice(page);
  await browse(page);
  await expect(page.getByText("Expired-session board", { exact: true })).toBeVisible();
  await openBoard(page, "Expired-session board");
  await expect(page.getByText("Private draft before expiry", { exact: true })).toBeVisible();
  await details(page);
  await page.getByRole("button", { name: "Retry account save", exact: true }).click();
  await closeDialogs(page);
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  expect(cloud.boards.get(firstId)?.document?.content.objects[0]).toMatchObject({ title: "Private draft before expiry" });
});

test("a delayed account document cannot replace the guest canvas after sign-out", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Delayed board")]);
  await page.goto("/scribble/"); await backToDevice(page);
  await page.getByLabel("Board title").fill("Guest during account request");
  await createNote(page, "Guest while opening");
  const guestObjects = (await canvasState(page)).objects;
  let release!: () => void;
  let started!: () => void;
  cloud.documentGate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  cloud.documentStarted = started;
  await browse(page);
  await page.getByRole("listitem").filter({ has: page.getByText("Delayed board", { exact: true }) }).locator(".board-open").click();
  await requestStarted;
  await accountMenu(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await closeDialogs(page);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  release();
  await expect(page.getByLabel("Board title")).toHaveValue("Guest during account request");
  expect((await canvasState(page)).objects).toEqual(guestObjects);
  await expect(page.getByText("Delayed board", { exact: true })).toHaveCount(0);
  expect(cloud.mutations).toEqual([]);
});

test("sign-out during an account reload returns to the guest board and ignores the pending remote version", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Reloading account board")]);
  await page.goto("/scribble/"); await backToDevice(page);
  await page.getByLabel("Board title").fill("Guest during reload");
  await createNote(page, "Guest remains visible after logout");
  const guestObjects = (await canvasState(page)).objects;
  await openBoard(page, "Reloading account board");
  cloud.failSaves = true;
  await editNote(page, "Reloading account board", "Unsent private draft");
  await expect(page.locator(".save-status")).toContainText("Account save failed");
  let release!: () => void;
  let started!: () => void;
  cloud.documentGate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  cloud.documentStarted = started;
  await details(page);
  await page.getByRole("button", { name: "Use account version", exact: true }).click();
  await page.getByRole("dialog", { name: "Use account version", exact: true }).getByRole("button", { name: "Use account version", exact: true }).click();
  await closeDialogs(page);
  await requestStarted;
  await accountMenu(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await closeDialogs(page);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  release();
  await expect(page.getByLabel("Board title")).toHaveValue("Guest during reload");
  expect((await canvasState(page)).objects).toEqual(guestObjects);
  await expect(page.getByText("Reloading account board", { exact: true })).toHaveCount(0);
  expect(documentWrites(cloud)).toHaveLength(1);
});

test("new account boards and explicit rename/delete leave the guest board intact", async ({ page }) => {
  const cloud = await mockAccount(page);
  await page.goto("/scribble/"); await backToDevice(page);
  await page.getByLabel("Board title").fill("Guest title stays");
  await createNote(page, "Guest stays too");
  const guestObjects = (await canvasState(page)).objects;
  await newAccountBoard(page);
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  expect((await canvasState(page)).objects).toEqual({});
  const created = [...cloud.boards.values()][0];
  expect(created.document?.content.objects).toEqual([]);
  const row = page.getByRole("listitem").filter({ has: page.getByText(created.title, { exact: true }) });
  await rowActions(page, created.title);
  await row.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("New board title").fill("Renamed account board");
  await page.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(page.getByLabel("Board title")).toHaveValue("Renamed account board");
  await rowActions(page, "Renamed account board");
  await page.getByRole("listitem").filter({ has: page.getByText("Renamed account board", { exact: true }) }).getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete board", exact: true }).click();
  await closeDialogs(page);
  await expect(page.getByText("Your workspace is empty.", { exact: true })).toBeVisible();
  await backToDevice(page);
  await expect(page.getByLabel("Board title")).toHaveValue("Guest title stays");
  expect((await canvasState(page)).objects).toEqual(guestObjects);
  expect(cloud.boards.size).toBe(0);
  expect(cloud.mutations.map((mutation) => mutation.method)).toEqual(["POST", "PUT", "PATCH", "DELETE"]);
});

test("cached board titles stay visible during refresh failure and recover on retry", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Cached board")]);
  await page.goto("/scribble/"); await backToDevice(page);
  await browse(page);
  await expect(page.getByText("Cached board", { exact: true })).toBeVisible();
  let release!: () => void;
  cloud.listGate = new Promise<void>((resolve) => { release = resolve; });
  cloud.failLists = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Refreshing boards…", { exact: true })).toBeVisible();
  await browse(page);
  await expect(page.getByText("Cached board", { exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("alert").filter({ hasText: "Showing the last loaded list" })).toBeVisible();
  await browse(page);
  await expect(page.getByText("Cached board", { exact: true })).toBeVisible();
  cloud.failLists = false;
  cloud.listGate = null;
  cloud.boards.get(firstId)!.title = "Refreshed board";
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Refreshed board", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Showing the last loaded list" })).toHaveCount(0);
  expect(cloud.mutations).toEqual([]);
});

test("fresh lists avoid focus requests and stale focus refresh leaves the active canvas alone", async ({ page }) => {
  async function refocus() {
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    });
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    });
  }
  await page.clock.install();
  const cloud = await mockAccount(page, [savedBoard(firstId, "Focus board")]);
  await page.goto("/scribble/"); await backToDevice(page);
  await openBoard(page, "Focus board");
  const before = await canvasState(page);
  const reads = cloud.listRequests;
  await refocus();
  await page.waitForTimeout(100);
  expect(cloud.listRequests).toBe(reads);
  cloud.boards.get(firstId)!.title = "Changed title elsewhere";
  cloud.boards.get(firstId)!.document = savedBoard(firstId, "Remote canvas change").document;
  await page.clock.fastForward(31_000);
  await refocus();
  await browse(page);
  await expect(page.getByText("Changed title elsewhere", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Board title")).toHaveValue("Focus board");
  expect(await canvasState(page)).toEqual(before);
  expect(cloud.mutations).toEqual([]);
});

test("reconnect refreshes the board list without submitting guest work", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Before reconnect")]);
  await page.goto("/scribble/"); await backToDevice(page);
  await browse(page);
  await expect(page.getByText("Before reconnect", { exact: true })).toBeVisible();
  await closeDialogs(page);
  await page.getByLabel("Board title").fill("Local reconnect draft");
  await browse(page);
  cloud.boards.get(firstId)!.title = "After reconnect";
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("After reconnect", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Board title")).toHaveValue("Local reconnect draft");
  expect(cloud.mutations).toEqual([]);
});

test("an older list refresh cannot roll back an acknowledged rename", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Before rename")]);
  await page.goto("/scribble/"); await backToDevice(page);
  await browse(page);
  await expect(page.getByText("Before rename", { exact: true })).toBeVisible();
  let release!: () => void;
  let started!: () => void;
  cloud.listGate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  cloud.listStarted = started;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await requestStarted;
  cloud.listGate = null;
  await rowActions(page, "Before rename");
  await page.getByRole("listitem").filter({ has: page.getByText("Before rename", { exact: true }) }).getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("New board title").fill("Acknowledged rename");
  await page.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(page.getByText("Acknowledged rename", { exact: true })).toBeVisible();
  release();
  await expect(page.getByText("Before rename", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Acknowledged rename", { exact: true })).toBeVisible();
  expect(cloud.mutations.map((mutation) => mutation.method)).toEqual(["PATCH"]);
});

test("a lost save acknowledgement reconciles a fresh revision without duplicating the write", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Lost response board")]);
  await page.goto("/scribble/"); await backToDevice(page);
  await openBoard(page, "Lost response board");
  cloud.loseNextSaveResponse = true;
  await editNote(page, "Lost response board", "Accepted before response loss");
  await expect(page.locator(".save-status")).toContainText("Account save failed");
  expect(documentWrites(cloud)).toHaveLength(1);
  expect(cloud.boards.get(firstId)?.document?.revision).toBe(2);
  await details(page);
  await page.getByRole("button", { name: "Retry account save", exact: true }).click();
  await closeDialogs(page);
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  expect(documentWrites(cloud)).toHaveLength(2);
  expect(new Set(documentWrites(cloud).map((mutation) => mutation.body.operationId)).size).toBe(1);
  expect(cloud.boards.get(firstId)?.document?.revision).toBe(2);
  await expect(page.getByText("Accepted before response loss", { exact: true })).toBeVisible();
});
