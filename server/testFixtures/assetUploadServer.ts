import pg from "pg";
import { createAuthenticatedApp } from "./authenticatedApp.js";
import { createControlledImageStorage } from "./controlledImageStorage.js";
import { createPostgresBoardStore } from "../postgresBoards.js";
import { createPostgresDocumentStore } from "../postgresDocuments.js";
import { createPostgresAssetStore } from "../postgresAssets.js";
import { createImageAssetService } from "../imageAssets.js";
import { createPrismaClient } from "../prisma.js";

const schema = process.env.TEST_ASSET_UPLOAD_SCHEMA, databaseUrl = process.env.TEST_DATABASE_URL, providerUrl = process.env.TEST_IMAGE_PROVIDER_URL;
if (!databaseUrl || !schema || !/^scribble_upload_test_[a-f0-9]{32}$/.test(schema) || !providerUrl || !process.send) {
  throw new Error("Disposable asset-upload schema, loopback provider and IPC required");
}
const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
const prisma = createPrismaClient(pool, schema);
const service = createImageAssetService(createPostgresAssetStore(prisma), createControlledImageStorage(providerUrl));
const server = createAuthenticatedApp(createPostgresBoardStore(prisma), createPostgresDocumentStore(prisma), undefined, undefined, service)
  .listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address !== "string") process.send!({ port: address.port });
  });
process.on("message", async (message) => {
  if (message !== "stop") return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await prisma.$disconnect(); await pool.end(); process.disconnect();
});
