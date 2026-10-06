// Actual process-restart proof for M3. This server can only use a disposable
// schema created by postgresPageCreation.test.ts; it never migrates databases.
import pg from "pg";
import { createAuthenticatedApp } from "./authenticatedApp.js";
import { createPostgresBoardStore } from "../postgresBoards.js";
import { createPostgresDocumentStore } from "../postgresDocuments.js";
import { createPrismaClient } from "../prisma.js";

const schema = process.env.TEST_CREATION_SCHEMA;
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !schema || !/^scribble_creation_test_[a-f0-9]{32}$/.test(schema) || !process.send) {
  throw new Error("A disposable creation-test schema and IPC are required");
}
const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
const prisma = createPrismaClient(pool, schema);
const server = createAuthenticatedApp(createPostgresBoardStore(prisma), createPostgresDocumentStore(prisma))
  .listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address !== "string") process.send!({ port: address.port });
  });
process.on("message", async (message) => {
  if (message !== "stop") return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await prisma.$disconnect();
  await pool.end();
  process.disconnect();
});
