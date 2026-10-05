import { createApp } from "./app.js";
import { loadServerConfig } from "./config.js";
import { createDatabasePool, loadDatabaseUrl } from "./database.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPostgresDocumentStore } from "./postgresDocuments.js";
import { loadAuthConfig } from "./authConfig.js";
import { createGoogleAuthProvider } from "./googleAuth.js";
import { createPostgresAuthStore } from "./postgresAuth.js";
import { createPrismaClient } from "./prisma.js";

const config = loadServerConfig();
const authConfig = loadAuthConfig();
const pool = createDatabasePool(loadDatabaseUrl());
const prisma = createPrismaClient(pool);
async function closeDatabase() {
  try { await prisma.$disconnect(); } finally { await pool.end(); }
}
try {
  await prisma.$queryRaw`SELECT id, owner_id FROM boards LIMIT 0`;
  await prisma.$queryRaw`SELECT board_id FROM board_documents LIMIT 0`;
  await prisma.$queryRaw`SELECT id FROM users LIMIT 0`;
  await prisma.$queryRaw`SELECT token_hash FROM auth_sessions LIMIT 0`;
  await prisma.$queryRaw`SELECT state_hash FROM google_auth_flows LIMIT 0`;
} catch {
  console.error("Could not connect to the board database. Check DATABASE_URL and run npm run db:migrate.");
  await closeDatabase();
  process.exit(1);
}
const server = createApp(createPostgresBoardStore(prisma), createPostgresDocumentStore(prisma), {
  store: createPostgresAuthStore(prisma), provider: authConfig.google ? createGoogleAuthProvider(authConfig.google) : null,
  frontendUrl: authConfig.frontendUrl, secureCookies: authConfig.secureCookies,
}).listen(config.port, config.host, () => {
  console.log(`Scribble API: http://${config.host}:${config.port} (PostgreSQL via Prisma, local only)`);
  if (!authConfig.google) console.log("Google sign-in is disabled until its environment settings are configured");
});

server.on("error", (error) => {
  console.error("Could not start the API:", error.message);
  process.exitCode = 1;
  void closeDatabase();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => { void closeDatabase(); });
  });
}
