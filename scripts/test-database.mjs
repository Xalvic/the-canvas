import { spawnSync } from "node:child_process";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Set TEST_DATABASE_URL or configure the local .env before running database tests.");
  process.exit(1);
}
// Tests create/drop only a new random schema, never reset the supplied database.
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "server/postgresBoards.test.ts", "server/migrations.test.ts", "server/postgresDocuments.test.ts", "server/postgresAuth.test.ts", "server/postgresOwnership.test.ts", "server/postgresSharing.test.ts", "server/postgresAssets.test.ts", "server/postgresCollaboration.test.ts", "server/productionBudgets.test.ts"], {
  stdio: "inherit", windowsHide: true, env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
});
process.exitCode = result.status ?? 1;
