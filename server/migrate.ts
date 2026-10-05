import { createDatabasePool, loadDatabaseUrl } from "./database.js";
import { migrateDatabase } from "./migrations.js";
import { requireVerifiedDatabaseTls } from "./productionConfig.js";

let pool;
try {
  const url = loadDatabaseUrl({ ...process.env, DATABASE_URL: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL });
  if (process.env.DEPLOYMENT_ENV === "production") {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("Production TLS verification must remain enabled");
    requireVerifiedDatabaseTls(url, "Migration database URL");
  }
  pool = createDatabasePool(url);
  await migrateDatabase(pool);
  console.log("PostgreSQL migrations applied");
} catch {
  console.error("Migration failed. Check DATABASE_URL, database availability, and schema permissions.");
  process.exitCode = 1;
} finally {
  await pool?.end();
}
