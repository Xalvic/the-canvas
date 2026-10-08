import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const file = 'ui-redesign-evidence/r7-inherited-work.json';
const hash = (path) => existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
const entries = () => execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean).map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }));
const permitted = new Set(['UI_REDESIGN_IMPLEMENTATION_PLAN.md', 'docs/ui-redesign-r7.md', 'src/persistence/shareLinkActions.test.ts', 'e2e/fixtures/account.ts', 'e2e/account-boards.spec.ts', 'e2e/ui-primitives.spec.ts', 'e2e/ux-layout.spec.ts', 'e2e/ux-simplification.spec.ts', 'e2e-integration/sharing.spec.ts']);
for (const path of ['e2e/workspace-wake.spec.ts', 'e2e-integration/cloud-images.spec.ts', 'e2e-integration/collaboration.spec.ts', 'e2e-integration/cross-tab.spec.ts', 'e2e-integration/fixture.ts', 'e2e-integration/workspace-ui.spec.ts', 'e2e-integration/workspace-navigation.spec.ts', 'e2e-integration/workspace-journals.spec.ts', 'e2e-integration/workspace-saving.spec.ts']) permitted.add(path);
const r7 = (path) => /(^|\/)r7[-.]/.test(path) || path === 'e2e/fixtures/shareLinks.ts' || path === 'e2e/freshness.spec.ts';
permitted.add('src/workspace-shell.css');
permitted.add('e2e/workspace-shell.spec.ts');
permitted.add('e2e/editor-controls.spec.ts');
permitted.add('e2e-integration/guest-transfer.spec.ts');
if (process.argv[2] === 'before') {
  const inherited = entries().filter((entry) => !r7(entry.path)).map((entry) => ({ ...entry, hash: hash(entry.path) }));
  writeFileSync(file, JSON.stringify({ inherited }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ inheritedEntries: inherited.length }));
} else {
  const baseline = JSON.parse(readFileSync(file, 'utf8'));
  const changed = baseline.inherited.filter((entry) => hash(entry.path) !== entry.hash);
  const unexpected = changed.filter((entry) => !permitted.has(entry.path));
  const additions = entries().filter((entry) => !baseline.inherited.some((before) => before.path === entry.path) && !r7(entry.path) && !permitted.has(entry.path));
  writeFileSync('ui-redesign-evidence/r7-preservation.json', JSON.stringify({ unchanged: baseline.inherited.length - changed.length, allowedChanges: changed.map((entry) => entry.path), unexpected, additions }, null, 2) + '\n');
  console.log(JSON.stringify({ unchanged: baseline.inherited.length - changed.length, allowedChanges: changed.map((entry) => entry.path), unexpected, additions }));
  if (unexpected.length || additions.length) process.exitCode = 1;
}
