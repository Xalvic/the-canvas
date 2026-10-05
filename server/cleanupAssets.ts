import { createDatabasePool, loadDatabaseUrl } from "./database.js";
import { createPrismaClient } from "./prisma.js";
import { createPostgresAssetStore } from "./postgresAssets.js";
import { loadImageKitConfig } from "./imageConfig.js";
import { createImageKitStorage } from "./imageKit.js";
import { createImageAssetService } from "./imageAssets.js";

const config = loadImageKitConfig();
if (!config) throw new Error("Configure backend ImageKit settings before running asset cleanup");
const pool = createDatabasePool(loadDatabaseUrl());
const prisma = createPrismaClient(pool);
try {
  const result = await createImageAssetService(createPostgresAssetStore(prisma), createImageKitStorage(config)).cleanup();
  console.log("Abandoned image cleanup:", result);
  if (result.deferred > 0) process.exitCode = 1;
} catch {
  console.error("Asset cleanup could not complete. Check the database/migrations and backend ImageKit configuration");
  process.exitCode = 1;
} finally {
  try { await prisma.$disconnect(); } finally { await pool.end(); }
}
