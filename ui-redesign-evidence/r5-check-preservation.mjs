import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(root, 'ui-redesign-evidence/r5-inherited-work.json');
const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
const current = new Map(status.trimEnd().split('\n').map((line) => [line.slice(3).replace(/^"|"$/g, ''), line.slice(0, 2)]));
const hash = (path) => existsSync(resolve(root, path)) ? createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') : undefined;
const allowed = new Set([
  'UI_REDESIGN_IMPLEMENTATION_PLAN.md', 'docs/ui-redesign-r5.md',
  'src/components/ServerBoards/ServerBoards.tsx', 'src/components/ServerBoards/Sharing.tsx',
  'src/components/ServerBoards/ShareControls.tsx', 'src/components/Account/Account.tsx',
  'src/components/AppMenu.tsx', 'src/persistence/workspaceController.ts',
  'src/persistence/workspaceController.test.ts', 'src/persistence/shareLinkIntent.ts',
  'src/persistence/shareLinkIntent.test.ts', 'src/persistence/shareLinkActions.ts',
  'src/persistence/shareLinkActions.test.ts', 'src/share-controls.css', 'src/styles.css',
  'scripts/e2e-api-fixture.ts', 'e2e-integration/share-links.spec.ts',
]);
if (process.argv.includes('--capture')) {
  if (existsSync(baselinePath)) throw new Error('R5 baseline already exists');
  const paths = new Set([...current.keys(), ...allowed, 'docs/learning-checkpoint.md', 'docs/learning-plan.md', 'docs/learning-progress.md']);
  const baseline = [...paths].filter((path) => !path.startsWith('ui-redesign-evidence/r5-')).map((path) => ({ path, status: current.get(path) ?? '  ', sha256: hash(path) }));
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`Captured ${baseline.length} inherited entries`);
} else {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const protectedEntries = baseline.filter((file) => !allowed.has(file.path));
  const changed = protectedEntries.filter((file) => hash(file.path) !== file.sha256 || (current.get(file.path) ?? '  ') !== file.status).map((file) => file.path);
  const inherited = new Set(baseline.map((file) => file.path));
  const unexpected = [...current.keys()].filter((path) => !inherited.has(path) && !allowed.has(path) && !path.startsWith('ui-redesign-evidence/r5-'));
  const result = { inspected: protectedEntries.length, changedInheritedFiles: changed, unexpectedFiles: unexpected, oldPlanRemainsDeleted: !existsSync(resolve(root, 'WORKSPACE_UX_IMPLEMENTATION_PLAN.md')) };
  writeFileSync(resolve(root, 'ui-redesign-evidence/r5-preservation.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (changed.length || unexpected.length || !result.oldPlanRemainsDeleted) process.exitCode = 1;
}
