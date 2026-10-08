import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('R4 validation requires a disposable-schema loopback PostgreSQL connection');
}
const databaseTests = [
  'server/postgresBoards.test.ts', 'server/postgresPageCreation.test.ts',
  'server/postgresWorkspace.test.ts', 'server/migrations.test.ts',
  'server/postgresDocuments.test.ts', 'server/postgresAuth.test.ts',
  'server/postgresOwnership.test.ts', 'server/postgresSharing.test.ts',
  'server/postgresShareLinks.test.ts', 'server/postgresAssets.test.ts',
  'server/postgresAssetUploads.test.ts', 'server/postgresCollaboration.test.ts',
  'server/productionBudgets.test.ts',
];
function run(name, files, env) {
  const outputFile = `ui-redesign-evidence/r4-${name}-results.json`;
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...files, '--reporter=json', `--outputFile=${outputFile}`], {
    stdio: 'pipe', encoding: 'utf8', windowsHide: true, env,
  });
  const report = JSON.parse(readFileSync(outputFile, 'utf8'));
  const failures = report.testResults.flatMap((suite) => suite.assertionResults.filter((test) => test.status === 'failed').map((test) => test.fullName));
  // Summaries never print request bodies, tokens, cookies or connection strings.
  console.log(JSON.stringify({ gate: name, passed: report.numPassedTests, failed: report.numFailedTests, pending: report.numPendingTests, failures }));
  if (result.status !== 0 || !report.success) process.exit(1);
}
run('fast', [], { ...process.env, TEST_DATABASE_URL: '' });
run('database', databaseTests, { ...process.env, TEST_DATABASE_URL: databaseUrl });
