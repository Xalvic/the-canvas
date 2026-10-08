import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const gate = process.argv[2];
if (!['fast', 'database'].includes(gate)) throw new Error('Use fast or database');
const databaseUrl = process.env.DATABASE_URL;
if (gate === 'database' && (!databaseUrl || !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname))) throw new Error('Use loopback disposable-schema database');
const files = gate === 'fast' ? [] : [
  'server/postgresBoards.test.ts', 'server/postgresPageCreation.test.ts', 'server/postgresWorkspace.test.ts',
  'server/migrations.test.ts', 'server/postgresDocuments.test.ts', 'server/postgresAuth.test.ts',
  'server/postgresOwnership.test.ts', 'server/postgresSharing.test.ts', 'server/postgresShareLinks.test.ts',
  'server/postgresAssets.test.ts', 'server/postgresAssetUploads.test.ts', 'server/postgresCollaboration.test.ts',
  'server/productionBudgets.test.ts',
];
const outputFile = `ui-redesign-evidence/r7-${gate}-results.json`;
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...files, '--maxWorkers=2', '--reporter=json', `--outputFile=${outputFile}`], {
  stdio: 'pipe', encoding: 'utf8', windowsHide: true, env: { ...process.env, TEST_DATABASE_URL: gate === 'fast' ? '' : databaseUrl },
});
const report = JSON.parse(readFileSync(outputFile, 'utf8'));
const failures = report.testResults.flatMap((suite) => suite.assertionResults.filter((test) => test.status === 'failed').map((test) => test.fullName));
console.log(JSON.stringify({ gate, passed: report.numPassedTests, failed: report.numFailedTests, pending: report.numPendingTests, failures }));
if (result.status !== 0 || !report.success) process.exitCode = 1;
