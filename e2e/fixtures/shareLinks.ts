import { expect, type Page } from '@playwright/test';
import type { mockAccount } from './account';
import { closeDialogs } from './ui';

export async function linkSettings(page: Page) {
  await closeDialogs(page);
  await page.getByRole('button', { name: 'App menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Link settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Link settings', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Finite UI fixture; actual receipts/access/crypto are exercised by the SQL/API gate. */
export async function mockShareLinks(page: Page, cloud: Awaited<ReturnType<typeof mockAccount>>, boardId: string) {
  cloud.shareLinksEnabled = true;
  const fixture = { settings: { enabled: false, role: 'viewer' as 'viewer' | 'editor', generation: 0, version: 0 },
    failReads: false, loseNextCopyResponse: false, reads: 0, copyRequests: [] as { requestId: string; expectedVersion: number }[] };
  const receipts = new Map<string, object>();
  await page.route(new RegExp(`/api/boards/${boardId}/share-link(?:/copy)?$`), async (route) => {
    const request = route.request();
    expect(request.headers()['x-scribble-account']).toBeDefined();
    if (request.method() === 'GET') {
      fixture.reads++;
      await route.fulfill(fixture.failReads ? { status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Disposable link read failure' } } } : { json: { settings: fixture.settings } });
      return;
    }
    expect(request.headers()['x-scribble-request']).toBe('1');
    const input = request.postDataJSON();
    if (request.method() === 'POST') {
      fixture.copyRequests.push(input);
      const receipt = receipts.get(input.requestId);
      if (receipt) { await route.fulfill({ json: { ...receipt, replayed: true } }); return; }
      fixture.settings = { ...fixture.settings, enabled: true, generation: 1, version: fixture.settings.version + 1 };
      const result = { settings: fixture.settings, token: 'a'.repeat(43), requestId: input.requestId, replayed: false };
      receipts.set(input.requestId, result);
      if (fixture.loseNextCopyResponse) { fixture.loseNextCopyResponse = false; await route.abort('failed'); return; }
      await route.fulfill({ json: result }); return;
    }
    fixture.settings = { ...fixture.settings, ...('role' in input ? { role: input.role } : { enabled: false }), version: fixture.settings.version + 1 };
    await route.fulfill({ json: { settings: fixture.settings, requestId: input.requestId, replayed: false } });
  });
  return fixture;
}
