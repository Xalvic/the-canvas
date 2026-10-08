// Local visual/layout gate only. No backend, provider, database or app storage.
// Start Vite on 4178, then: node ui-redesign-evidence/r0-verify.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4178/scribble/docs/ui-redesign-proposal.html';
const evidence = new URL('./', import.meta.url);
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [], apiRequests = [];
const checks = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => { if (/\/api\/|accounts\.google|example\.invalid/.test(request.url())) apiRequests.push(request.url()); });
const pass = (name) => checks.push(name);
const visible = async (selector) => page.locator(selector).isVisible();
const capture = async (name) => page.screenshot({ animations: 'disabled', path: new URL(`r0-${name}.png`, evidence).pathname.replace(/^\/(\w:)/, '$1') });

async function load({ width = 1440, height = 900, theme = 'light', scenario = 'owner', state = 'canvas', styles = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(`${base}?${new URLSearchParams({ theme, scenario, state, styles: styles ? 'open' : 'closed' })}`);
  await page.locator('.title-input').waitFor({state:'attached'});
}
async function geometry(label, selectors = ['.title-cluster','.share-cluster','.styles:not([hidden])','.styles-trigger:not([hidden])','.dock-region','.zoom','.notice:not([hidden])']) {
  const result = await page.evaluate((selectors) => {
    const rects = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]).filter((element) => element.getClientRects().length).map((element) => {
      const box = element.getBoundingClientRect(); return { name: element.className, x: box.x, y: box.y, right: box.right, bottom: box.bottom };
    });
    const outside = rects.filter((rect) => rect.x < -1 || rect.y < 35 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1);
    const overlaps = rects.flatMap((a,index) => rects.slice(index + 1).filter((b) => Math.min(a.right,b.right)-Math.max(a.x,b.x)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1).map((b) => `${a.name}/${b.name}`));
    return { outside, overlaps, overflow: document.documentElement.scrollWidth > innerWidth };
  },selectors);
  assert.deepEqual(result,{outside:[],overlaps:[],overflow:false},label);
}

try {
  for (const theme of ['light','dark']) {
    for (const [name, scenario, width, height] of [
      ['owner-desktop','owner',1440,900], ['collapsed-desktop','collapsed',1440,900],
      ['guest-desktop','guest',1440,900], ['owner-mobile','owner',390,844],
      ['guest-mobile','guest',390,844]
    ]) {
      await load({ theme, scenario, width, height });
      await geometry(`${name}-${theme}`);
      assert.equal(await page.getByRole('button',{ name: /Refresh/ }).count(),0);
      const top = await page.locator('.title-cluster').evaluate((element) => ({ background:getComputedStyle(element).backgroundColor, border:getComputedStyle(element).borderTopWidth }));
      assert.equal(top.background,'rgba(0, 0, 0, 0)'); assert.equal(top.border,'0px');
      await capture(`${name}-${theme}`); pass(`${name}-${theme}`);
    }
    for (const size of [{width:320,height:700},{width:360,height:640},{width:740,height:390},{width:768,height:1024},{width:1024,height:768},{width:1100,height:600},{width:1101,height:600},{width:1440,height:360},{width:390,height:420}]) {
      await load({ ...size, theme, state:'long' });
      await geometry(`long-title ${size.width}x${size.height} ${theme}`);
      await page.getByRole('button',{name:'Pen tool',exact:true}).click();
      if (!await visible('.styles')) await page.getByRole('button',{name:'Style',exact:true}).click();
      await geometry(`styles ${size.width}x${size.height} ${theme}`);
      await page.getByRole('button',{name:'Close settings',exact:true}).click();
      await page.getByRole('button',{name:'Page menu',exact:true}).click();
      await geometry(`page menu ${size.width}x${size.height} ${theme}`,['.page-menu']);
      await page.getByRole('menuitem',{name:'Link settings',exact:true}).click();
      await geometry(`link settings ${size.width}x${size.height} ${theme}`,['.link-panel']);
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button',{name:'Page menu',exact:true}).evaluate((element) => element === document.activeElement),true);
      pass(`long title, styles, menus ${size.width}x${size.height} ${theme}`);
    }
  }

  await load();
  await page.getByRole('button',{name:'Share',exact:true}).click();
  await page.waitForTimeout(250);
  assert.match(await page.locator('.toast').textContent(),/Simulated · Link copied · Can view/);
  assert.equal(await visible('.link-panel'),false); assert.equal(await page.locator('dialog[open]').count(),0);
  assert.equal(await page.getByRole('textbox',{name:/email/i}).count(),0);
  pass('one-click owner share, viewer default, no modal/email/second copy');
  await capture('owner-link-copied');
  await page.getByRole('button',{name:'Page menu',exact:true}).click();
  await page.getByRole('menuitem',{name:'Link settings',exact:true}).click();
  await page.getByLabel('Link permission',{exact:true}).selectOption('editor');
  assert.match(await page.locator('#link-status').textContent(),/Can edit/);
  await capture('link-settings');
  await page.getByRole('button',{name:'Stop sharing',exact:true}).click();
  assert.equal(await page.locator('#link-status').textContent(),'Link sharing is off');
  assert.equal(await page.getByRole('button',{name:'Enable & copy link',exact:true}).isVisible(),true);
  pass('role change and stopping/re-enabling sharing are reviewable');

  for (const [state, text, screenshot] of [['clipboard','Link ready. Your browser blocked copying.','clipboard-fallback'],['share-error','Couldn’t create the link. Try Share again.','link-failure']]) {
    await load({state}); await page.getByRole('button',{name:'Share',exact:true}).click(); await page.waitForTimeout(250);
    assert.equal(await page.getByText(text,{exact:true}).isVisible(),true);
    await capture(screenshot); pass(`${state} distinct from copy success`);
  }
  await load({state:'clipboard'}); await page.getByRole('button',{name:'Share',exact:true}).click(); await page.waitForTimeout(250);
  await page.getByRole('button',{name:'Copy link',exact:true}).click();
  assert.match(await page.locator('.toast').textContent(),/Simulated · Link copied/);
  pass('clipboard failure has selectable URL and explicit retry');
  await load();
  await page.getByRole('button',{name:'Share',exact:true}).click(); await page.locator('#scenario').selectOption('guest'); await page.waitForTimeout(250);
  assert.equal(await visible('.toast'),false); pass('scenario switch fences simulated share completion');

  for(const theme of ['light','dark']) {
    for(const state of ['pending','error']) {
      await load({width:390,height:844,theme,state,styles:true});
      await geometry(`${state} mobile ${theme}`); await capture(`mobile-${state}-${theme}`);
      await load({width:740,height:390,theme,state,styles:true}); await geometry(`${state} short ${theme}`);
      await page.getByRole('button',{name:'Close settings',exact:true}).click();
      await load({width:390,height:420,theme,state,styles:true}); await geometry(`${state} narrow/short ${theme}`);
      await page.getByRole('button',{name:'Close settings',exact:true}).click();
      pass(`${state} notice/settings remain separate ${theme}`);
    }
  }
  await load({width:320,height:700});
  await page.getByRole('button',{name:'Pages',exact:true}).click();
  await geometry('mobile drawer',['dialog.drawer[open]']);
  for(let i=0;i<18;i++) { await page.keyboard.press('Tab'); assert.equal(await page.locator('.drawer').evaluate((element) => element.contains(document.activeElement)),true); }
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('button',{name:'Pages',exact:true}).evaluate((element) => element === document.activeElement),true);
  await page.getByRole('button',{name:'More tools',exact:true}).click(); await page.keyboard.press('End');
  assert.equal(await page.getByRole('menuitem',{name:'Frame',exact:true}).evaluate((element) => element === document.activeElement),true);
  await page.keyboard.press('Escape'); pass('drawer focus trap/restore and keyboard overflow traversal');

  await load({width:390,height:420,scenario:'guest'});
  await page.getByRole('button',{name:'Share',exact:true}).click();
  assert.equal(await page.getByRole('dialog',{name:'Share your drawing',exact:true}).isVisible(),true);
  await geometry('guest share consent in reduced viewport',['dialog.action-dialog[open]']);
  await capture('guest-transfer-consent');
  await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
  assert.equal(await page.getByRole('dialog',{name:'Save this drawing to your account?',exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'Keep local',exact:true}).click();
  assert.equal(await page.locator('.workspace').getAttribute('data-scenario'),'guest');
  pass('guest share explicit sign-in/transfer preview and cancellation');

  await load({width:390,height:844,scenario:'guest'});
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport,{height:{configurable:true,value:380},offsetTop:{configurable:true,value:120}});
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.getByRole('button',{name:'Share',exact:true}).click();
  const keyboardBox = await page.locator('dialog.action-dialog[open]').boundingBox();
  assert.ok(keyboardBox.y >= 120 && keyboardBox.y + keyboardBox.height <= 500);
  await capture('visual-viewport-consent');
  await page.keyboard.press('Escape'); pass('consent bounded to simulated panned visual viewport');

  for(const theme of ['light','dark']) {
    await load({width:390,height:844,theme,state:'recipient'});
    assert.equal(await page.getByRole('textbox',{name:'Page title',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Sign in with Google',exact:true}).count(),1);
    await capture(`recipient-${theme}`); pass(`signed-out recipient shows no protected content ${theme}`);
  }
  await load({state:'unavailable'}); await capture('stopped-link');
  assert.equal(await page.getByRole('heading',{name:'This link is unavailable',exact:true}).isVisible(),true);
  pass('stopped link has privacy-preserving unavailable view');

  await load({state:'empty'}); await capture('empty-desktop'); pass('restrained empty hint');
  await load({state:'long',styles:true}); await capture('long-title-styles');
  await load({width:740,height:390,state:'error',styles:true}); await capture('short-landscape-error');

  await load();
  const input = page.getByRole('textbox',{name:'Page title',exact:true});
  await input.focus(); await input.fill('Canceled title'); await input.press('Escape'); assert.equal(await input.inputValue(),'A calmer workspace');
  await input.focus(); await input.fill('Committed title'); await input.press('Enter'); assert.equal(await input.inputValue(),'Committed title');
  pass('title Enter commit and Escape cancel');
  assert.deepEqual(errors,[]); assert.deepEqual(apiRequests,[]);
  pass('no browser errors, API/provider calls, or usable-link navigation');
  fs.writeFileSync(new URL('r0-verification.json',evidence),JSON.stringify({date:'2026-10-07',scope:'R0 illustrative proposal only',checksPassed:checks.length,checks,browserErrors:errors,apiRequests},null,2)+'\n');
  console.log(`${checks.length} proposal checks passed; screenshots and results saved in ui-redesign-evidence.`);
} finally { await browser.close(); }
