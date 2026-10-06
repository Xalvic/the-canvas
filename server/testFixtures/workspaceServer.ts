// Real process tests only: no migrations or normal database access.
import pg from "pg";
import { createAuthenticatedApp } from "./authenticatedApp.js";
import { createPostgresBoardStore } from "../postgresBoards.js";
import { createPostgresDocumentStore } from "../postgresDocuments.js";
import { createPostgresWorkspaceStore } from "../postgresWorkspace.js";
import { createPrismaClient } from "../prisma.js";

const schema = process.env.TEST_WORKSPACE_SCHEMA, databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !schema || !/^scribble_workspace_test_[a-f0-9]{32}$/.test(schema) || !process.send) {
  throw new Error("A disposable workspace-test schema and IPC are required");
}
const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
const prisma = createPrismaClient(pool, schema);
const server = createAuthenticatedApp(createPostgresBoardStore(prisma), createPostgresDocumentStore(prisma), undefined, createPostgresWorkspaceStore(prisma))
  .listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address !== "string") process.send!({ port: address.port });
  });
process.on("message", async (message) => {
  if (message !== "stop") return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await prisma.$disconnect(); await pool.end(); process.disconnect();
});
