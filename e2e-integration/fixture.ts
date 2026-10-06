import { browse, closeDialogs, details, backToDevice, newAccountBoard, explicitSave } from "../e2e/fixtures/ui";
import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import type { StoredCanvasObject } from "../server/contracts/collaboration";

export const BASE_URL = "http://127.0.0.1:4174";
export const mutationHeaders = { "X-Scribble-Request": "1" };
export const fixtureHeaders = () => ({ "X-Scribble-Fixture": process.env.SCRIBBLE_FIXTURE_TOKEN! });
export type IntegrationState = {
  document: { revision: number; content: { objects: StoredCanvasObject[] } } | null;
  assets: { id: string; status: string }[];
  receipts: { actor_id: string; operation_id: string; applied_revision: number }[];
};
export async function signIn(request: APIRequestContext, subject = `person-${randomUUID()}`) {
  const response = await request.post(`${BASE_URL}/api/__fixture/session`, { headers: fixtureHeaders(), data: { subject } });
  expect(response.ok()).toBeTruthy();
  return { subject, user: (await response.json()).user as { id: string; email: string } };
}
export async function membership(request: APIRequestContext, boardId: string, userId: string, role: "editor" | "viewer" | null) {
  expect((await request.post(`${BASE_URL}/api/__fixture/membership`, { headers: fixtureHeaders(), data: { boardId, userId, role } })).ok()).toBeTruthy();
}
export async function state(request: APIRequestContext, boardId: string): Promise<IntegrationState> {
  const response = await request.get(`${BASE_URL}/api/__fixture/state/${boardId}`, { headers: fixtureHeaders() });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
export async function network(request: APIRequestContext, dropOperationResponses = 0) {
  expect((await request.post(`${BASE_URL}/api/__fixture/network`, {
    headers: fixtureHeaders(), data: { dropOperationResponses },
  })).ok()).toBeTruthy();
}
export async function flushLocalDraft(page: Page) {
  await page.evaluate(async () => {
    const { waitForLocalBoardSave } = await import(/* @vite-ignore */ "/scribble/src/persistence/waitForLocalBoardSave.ts");
    await waitForLocalBoardSave(new AbortController().signal);
  });
}
export async function canvasState(page: Page) {
  return page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const { useBoardStore } = await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts");
    return { objects: Object.values(useDocumentStore.getState().objects), account: useBoardStore.getState().account };
  });
}
export async function openBoard(page: Page, title: string) {
  await browse(page);
  if (!await page.getByText(title, { exact: true }).isVisible()) await page.getByRole("button", { name: "Shared with me", exact: true }).click();
  await page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) }).locator(".board-open").click();
  await expect(page.getByLabel("Board title")).toHaveValue(title);
  await closeDialogs(page);
  await expect(page.getByLabel("Board title")).toBeVisible();
  await page.getByRole("button", { name: "Reset viewport", exact: true }).click();
}
export async function connected(page: Page) {
  await expect(page.locator('[data-collaboration-status="connected"]')).toBeVisible();
}
export async function editNote(page: Page, before: string, after: string) {
  await page.locator(".card-object-value").filter({ has: page.getByText(before, { exact: true }) }).dblclick();
  await page.getByLabel("Card title", { exact: true }).fill(after);
  await page.keyboard.press("Escape");
}
export async function createNote(page: Page, title: string, x: number, y: number) {
  await page.getByRole("button", { name: "Note tool", exact: true }).click();
  await page.mouse.click(x, y);
  await page.getByLabel("Card title", { exact: true }).fill(title);
  await page.keyboard.press("Escape");
}
export async function contextPage(context: BrowserContext, subject?: string) {
  const account = await signIn(context.request, subject);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/scribble/`);
  return { page, account };
}
