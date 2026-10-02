import { createDatabasePool, loadDatabaseUrl } from "./database.js";
import { migrateDatabase } from "./migrations.js";

let pool;
try {
  pool = createDatabasePool(loadDatabaseUrl());
  await migrateDatabase(pool);
  console.log("PostgreSQL migrations applied");
} catch {
  console.error("Migration failed. Check DATABASE_URL, database availability, and schema permissions.");
  process.exitCode = 1;
} finally {
  await pool?.end();
}
