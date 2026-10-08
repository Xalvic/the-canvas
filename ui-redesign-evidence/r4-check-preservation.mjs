import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(root, 'ui-redesign-evidence/r4-inherited-work.json');
const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
const current = new Map(status.trimEnd().split('\n').map((line) => [line.slice(3).replace(/^"|"$/g, ''), line.slice(0, 2)]));
const hash = (path) => existsSync(resolve(root, path)) ? createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') : undefined;
const allowed = new Set([
  'UI_REDESIGN_IMPLEMENTATION_PLAN.md', 'docs/ui-redesign-r4.md', '.env.example',
  'db/012_create_board_share_links.sql', 'prisma/schema.prisma', 'scripts/test-database.mjs',
  'server/shareLinks.ts', 'server/shareLinkCrypto.ts', 'server/shareLinks.test.ts',
  'server/postgresShareLinks.ts', 'server/postgresShareLinks.test.ts', 'server/shareLinkRoutes.ts',
  'server/boardPermissions.ts', 'server/postgresBoards.ts', 'server/postgresDocuments.ts',
  'server/postgresCollaboration.ts', 'server/postgresWorkspace.ts', 'server/authRoutes.ts',
  'server/app.ts', 'server/index.ts', 'server/production.ts', 'server/migrations.ts',
  'server/migrations.test.ts', 'server/postgresSharing.test.ts',
  'server/postgresAuth.test.ts', 'server/postgresBoards.test.ts',
  'server/postgresAssets.test.ts', 'server/postgresCollaboration.test.ts',
  'server/testFixtures/shareLinkServer.ts',
  'src/api/shareLinks.ts', 'src/api/shareLinks.test.ts', 'src/api/auth.ts', 'src/api/auth.test.ts',
]);
if (process.argv.includes('--capture')) {
  if (existsSync(baselinePath)) throw new Error('R4 baseline already exists');
  const paths = new Set([...current.keys(), 'docs/learning-checkpoint.md', 'docs/learning-plan.md', 'docs/learning-progress.md']);
  const baseline = [...paths].filter((path) => !path.startsWith('ui-redesign-evidence/r4-')).map((path) => ({ path, status: current.get(path) ?? '  ', sha256: hash(path) }));
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`Captured ${baseline.length} inherited entries`);
} else {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const protectedEntries = baseline.filter((file) => !allowed.has(file.path));
  const changed = protectedEntries.filter((file) => hash(file.path) !== file.sha256 || (current.get(file.path) ?? '  ') !== file.status).map((file) => file.path);
  const inherited = new Set(baseline.map((file) => file.path));
  const unexpected = [...current.keys()].filter((path) => !inherited.has(path) && !allowed.has(path) && !path.startsWith('ui-redesign-evidence/r4-'));
  const result = { inspected: protectedEntries.length, changedInheritedFiles: changed, unexpectedFiles: unexpected, oldPlanRemainsDeleted: !existsSync(resolve(root, 'WORKSPACE_UX_IMPLEMENTATION_PLAN.md')) };
  writeFileSync(resolve(root, 'ui-redesign-evidence/r4-preservation.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (changed.length || unexpected.length || !result.oldPlanRemainsDeleted) process.exitCode = 1;
}
