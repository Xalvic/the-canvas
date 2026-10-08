// Disposable R4 process-restart fixture. Never migrate or write normal schemas.
import express from "express";
import pg from "pg";
import { createApp } from "../app.js";
import { createPrismaClient } from "../prisma.js";
import { createPostgresBoardStore } from "../postgresBoards.js";
import { createPostgresDocumentStore } from "../postgresDocuments.js";
import { createPostgresAuthStore } from "../postgresAuth.js";
import { createPostgresShareLinkStore } from "../postgresShareLinks.js";
import { loadShareLinkKey } from "../shareLinkCrypto.js";

const schema = process.env.R4_TEST_SCHEMA;
const key = loadShareLinkKey();
if (!schema || !/^scribble_share_link_test_[a-f0-9]{32}$/.test(schema) || !process.env.TEST_DATABASE_URL || !key) throw new Error("Disposable R4 fixture configuration is required");
const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 5 });
const prisma = createPrismaClient(pool, schema);
const app = express();
let dropCopyResponse = process.env.R4_DROP_COPY_RESPONSE === "1";
app.use((req, res, next) => {
  if (dropCopyResponse && req.method === "POST" && req.path.endsWith("/share-link/copy")) {
    dropCopyResponse = false;
    // JSON is reached after the real database commit. Deliver no response bytes.
    res.json = () => { res.destroy(); return res; };
  }
  next();
});
app.use(createApp(createPostgresBoardStore(prisma), createPostgresDocumentStore(prisma), {
  store: createPostgresAuthStore(prisma), provider: null,
  frontendUrl: "http://127.0.0.1:5173/scribble/", secureCookies: false,
}, undefined, undefined, undefined, undefined, undefined, createPostgresShareLinkStore(prisma, key)));
const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture listener failed");
  console.log(JSON.stringify({ port: address.port }));
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  server.closeAllConnections();
  server.close(() => { void prisma.$disconnect().finally(() => pool.end()); });
});
