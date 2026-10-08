import { expect, test } from '@playwright/test';
import { canvasState, firstId, secondId, mockAccount, savedBoard } from './fixtures/account';
import { browse } from './fixtures/ui';

test('visible metadata polling pauses hidden/offline and reconnect keeps editor/history intact', async ({ page }) => {
  await page.clock.install();
  const cloud = await mockAccount(page, [savedBoard(firstId, 'Active drawing'), savedBoard(secondId, 'Other device page')]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/scribble/'); await expect(page.getByLabel('Page title')).toHaveValue('Active drawing'); await browse(page);
  const before = await canvasState(page), initialReads = cloud.listRequests;
  cloud.boards.get(secondId)!.title = 'Changed elsewhere';
  await page.clock.fastForward(31_000);
  await expect(page.getByText('Changed elsewhere', { exact: true })).toBeVisible();
  expect(cloud.listRequests).toBeGreaterThan(initialReads);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenReads = cloud.listRequests;
  await page.clock.fastForward(95_000);
  expect(cloud.listRequests).toBe(hiddenReads);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const offlineReads = cloud.listRequests;
  await page.clock.fastForward(95_000);
  expect(cloud.listRequests).toBe(offlineReads);
  cloud.boards.get(secondId)!.title = 'Reconnected page';
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByText('Reconnected page', { exact: true })).toBeVisible();
  expect(await canvasState(page)).toEqual(before);
  expect(cloud.mutations).toEqual([]);
});

test('opening a stale collapsed sidebar refreshes metadata without replacing the active drawing', async ({ page }) => {
  await page.clock.install();
  const cloud = await mockAccount(page, [savedBoard(firstId, 'Keep active'), savedBoard(secondId, 'Before sidebar')]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/scribble/'); await expect(page.getByLabel('Page title')).toHaveValue('Keep active'); await browse(page);
  const before = await canvasState(page);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(page.locator('.page-sidebar')).toBeHidden();
  const closedReads = cloud.listRequests;
  cloud.boards.get(secondId)!.title = 'After sidebar';
  await page.clock.fastForward(31_000);
  expect(cloud.listRequests).toBe(closedReads);
  await browse(page);
  await expect(page.getByText('After sidebar', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Refresh pages|Refresh invitations/ })).toHaveCount(0);
  expect(await canvasState(page)).toEqual(before);
  expect(cloud.mutations).toEqual([]);
});
