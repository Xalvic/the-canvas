import { browse, closeDialogs } from "./ui";
import { expect, type Page } from "@playwright/test";
import type { CanvasObject, CardCanvasObject } from "../../src/canvas/objects/types";
import type { BoardDocument } from "../../server/documents";
import { isDeepStrictEqual } from "node:util";

export const user = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", displayName: "Owner" };
const guest = { error: { code: "UNAUTHENTICATED", message: "Sign in to use account boards", details: { googleSignInEnabled: true } } };
export const firstId = "22222222-2222-4222-8222-222222222222";
export const secondId = "33333333-3333-4333-8333-333333333333";

type Metadata = { id: string; title: string; createdAt: number; updatedAt: number; role?: "owner" | "editor" | "viewer" };
type SavedBoard = Metadata & { document: BoardDocument | null };
type Mutation = { method: string; path: string; body: any };

export function note(id: string, title: string): CardCanvasObject {
  return { id, type: "card", title, body: "", x: 300, y: 450, width: 260, height: 150, zIndex: 1, createdAt: 1, updatedAt: 1 };
}

export function savedBoard(id: string, title: string, objects: CanvasObject[] = [note(`note-${id}`, title)]): SavedBoard {
  return { id, title, createdAt: 1, updatedAt: 1, document: { boardId: id, schemaVersion: 1, revision: 1, updatedAt: 1, content: { objects } } };
}

export async function mockAccount(page: Page, initial: SavedBoard[] = []) {
  // This suite isolates finite HTTP/draft behavior; the integration suite
  // exercises actual authorized SSE streams with two browser contexts.
  await page.addInitScript(() => { Object.defineProperty(window, "EventSource", { value: undefined }); });
  const receipts = new Map<string, string>();
  const cloud = {
    signedIn: true,
    failSaves: false,
    failLists: false,
    loseNextSaveResponse: false,
    listRequests: 0,
    conflictOnNextSave: false,
    mutations: [] as Mutation[],
    boards: new Map(initial.map((board) => [board.id, structuredClone(board)])),
    documentGate: null as Promise<void> | null,
    documentStarted: null as (() => void) | null,
    listGate: null as Promise<void> | null,
    listStarted: null as (() => void) | null,
  };
  let nextId = 4;
  await page.route("**/api/invitations", (route) => route.fulfill({ json: { invitations: [] } }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: cloud.signedIn ? 200 : 401, json: cloud.signedIn ? { user } : guest }));
  await page.route("**/api/auth/logout", (route) => {
    cloud.signedIn = false;
    return route.fulfill({ status: 204 });
  });
  await page.route(/\/api\/boards(?:\/[^/?]+(?:\/(?:document|operations|presence))?)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body = ["POST", "PATCH", "PUT"].includes(method) ? request.postDataJSON() : null;
    if (path.endsWith("/presence")) { await route.fulfill({ status: 204 }); return; }
    if (method !== "GET") {
      expect(request.headers()["x-scribble-request"]).toBe("1");
      cloud.mutations.push({ method, path, body });
    }
    if (!cloud.signedIn) { await route.fulfill({ status: 401, json: guest }); return; }
    if (path === "/api/boards") {
      if (method === "GET") {
        cloud.listRequests++;
        const boards = [...cloud.boards.values()].map(({ document: _document, ...board }) => board);
        cloud.listStarted?.();
        if (cloud.listGate) await cloud.listGate;
        await route.fulfill(cloud.failLists
          ? { status: 503, json: { error: { code: "UNAVAILABLE", message: "Try later" } } }
          : { json: { boards } }).catch(() => {});
      } else if (method === "POST") {
        const id = `${String(nextId++).padStart(8, "0")}-4444-4444-8444-444444444444`;
        const board = { id, title: body.title, createdAt: 1, updatedAt: 1, document: null };
        cloud.boards.set(id, board);
        await route.fulfill({ status: 201, json: { board } });
      }
      return;
    }
    const [, , , id, documentPath] = path.split("/");
    const board = cloud.boards.get(id);
    if (!board) { await route.fulfill({ status: 404, json: { error: { code: "BOARD_NOT_FOUND", message: "Board not found" } } }); return; }
    if (documentPath === "document" || documentPath === "operations") {
      if (method === "GET") {
        cloud.documentStarted?.();
        if (cloud.documentGate) await cloud.documentGate;
        await route.fulfill(board.document ? { json: { document: board.document } } : { status: 404, json: { error: { code: "DOCUMENT_NOT_FOUND", message: "This board has no saved document" } } }).catch(() => {});
        return;
      }
      if (cloud.failSaves) { await route.fulfill({ status: 503, json: { error: { code: "SERVER_ERROR", message: "Account save temporarily unavailable" } } }); return; }
      if (cloud.conflictOnNextSave) {
        cloud.conflictOnNextSave = false;
        board.document = { boardId: id, schemaVersion: 1, revision: (board.document?.revision ?? 0) + 1, updatedAt: 2, content: { objects: [note("remote-change", "Changed on another device")] } };
      }
      const revision = board.document?.revision ?? 0;
      if (documentPath === "operations") {
        const receipt = receipts.get(`${id}:${body.operationId}`);
        if (receipt) {
          expect(receipt).toBe(JSON.stringify(body));
          await route.fulfill({ json: { document: board.document, replayed: true } }); return;
        }
        const objects = new Map(board.document!.content.objects.map((object) => [object.id, object]));
        if (body.baseRevision > revision || body.changes.some((change: any) => !isDeepStrictEqual(objects.get(change.id) ?? null, change.before))) {
          await route.fulfill({ status: 409, json: { error: { code: "COLLABORATION_CONFLICT", message: "This board changed elsewhere.", details: { currentRevision: revision } } } }); return;
        }
        for (const change of body.changes) { if (change.after === null) objects.delete(change.id); else objects.set(change.id, change.after); }
        board.document = { ...board.document!, revision: revision + 1, updatedAt: Date.now(), content: { objects: [...objects.values()] } };
        receipts.set(`${id}:${body.operationId}`, JSON.stringify(body));
        if (cloud.loseNextSaveResponse) { cloud.loseNextSaveResponse = false; await route.abort("failed"); return; }
        await route.fulfill({ json: { document: board.document, replayed: false } }); return;
      }
      if (body.expectedRevision !== revision) {
        await route.fulfill({ status: 409, json: { error: { code: "REVISION_CONFLICT", message: "Document revision does not match", details: { currentRevision: revision } } } });
        return;
      }
      board.document = { boardId: id, schemaVersion: body.schemaVersion, revision: revision + 1, updatedAt: Date.now(), content: body.content };
      if (cloud.loseNextSaveResponse) { cloud.loseNextSaveResponse = false; await route.abort("failed"); return; }
      await route.fulfill({ status: revision === 0 ? 201 : 200, json: { document: board.document } });
      return;
    }
    if (method === "PATCH") {
      board.title = body.title;
      board.updatedAt = Date.now();
    } else if (method === "DELETE") {
      cloud.boards.delete(id);
      await route.fulfill({ status: 204 });
      return;
    }
    const { document: _document, ...metadata } = board;
    await route.fulfill({ json: { board: metadata } });
  });
  return cloud;
}

export async function canvasState(page: Page) {
  return page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const { useViewportStore } = await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts");
    const { objects, past, future } = useDocumentStore.getState();
    return { objects, past, future, viewport: useViewportStore.getState().viewport };
  });
}

export async function localBoard(page: Page) {
  return page.evaluate(async () => {
    const { loadLocalBoard } = await import(/* @vite-ignore */ "/scribble/src/persistence/localBoardStorage.ts");
    return loadLocalBoard();
  });
}

export async function createNote(page: Page, title: string) {
  await page.getByRole("button", { name: "Note tool", exact: true }).click();
  await page.mouse.click(330, 500);
  await page.getByLabel("Card title", { exact: true }).fill(title);
  await page.keyboard.press("Escape");
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

export async function editNote(page: Page, before: string, after: string) {
  await page.locator(".card-object-value").filter({ has: page.getByText(before, { exact: true }) }).dblclick();
  await page.getByLabel("Card title", { exact: true }).fill(after);
  await page.keyboard.press("Escape");
}

export async function openBoard(page: Page, title: string) {
  await browse(page);
  const shared = page.getByRole("button", { name: "Shared with me", exact: true });
  if (!await page.getByText(title, { exact: true }).isVisible()) await shared.click();
  await page.getByRole("button", { name: title, exact: false }).filter({ has: page.getByText(title, { exact: true }) }).click();
  await expect(page.getByLabel("Board title", { exact: true })).toHaveValue(title);
  await closeDialogs(page);
}

export function documentWrites(cloud: Awaited<ReturnType<typeof mockAccount>>) {
  return cloud.mutations.filter((mutation) => mutation.method === "PUT" || mutation.path.endsWith("/operations"));
}
