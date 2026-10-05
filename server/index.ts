import { createApp } from "./app.js";
import { loadServerConfig } from "./config.js";
import { createDatabasePool, loadDatabaseUrl } from "./database.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPostgresDocumentStore } from "./postgresDocuments.js";
import { loadAuthConfig } from "./authConfig.js";
import { createGoogleAuthProvider } from "./googleAuth.js";
import { createPostgresAuthStore } from "./postgresAuth.js";
import { createPrismaClient } from "./prisma.js";
import { createPostgresSharingStore } from "./postgresSharing.js";
import { loadImageKitConfig } from "./imageConfig.js";
import { createImageKitStorage } from "./imageKit.js";
import { createPostgresAssetStore } from "./postgresAssets.js";
import { createImageAssetService } from "./imageAssets.js";

const config = loadServerConfig();
const authConfig = loadAuthConfig();
const imageConfig = loadImageKitConfig();
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
  await prisma.$queryRaw`SELECT board_id FROM board_members LIMIT 0`;
  await prisma.$queryRaw`SELECT id FROM board_invitations LIMIT 0`;
  await prisma.$queryRaw`SELECT id FROM board_assets LIMIT 0`;
  await prisma.$queryRaw`SELECT bucket FROM asset_request_budgets LIMIT 0`;
} catch {
  console.error("Could not connect to the board database. Check DATABASE_URL and run npm run db:migrate.");
  await closeDatabase();
  process.exit(1);
}
const server = createApp(createPostgresBoardStore(prisma), createPostgresDocumentStore(prisma), {
  store: createPostgresAuthStore(prisma), provider: authConfig.google ? createGoogleAuthProvider(authConfig.google) : null,
  frontendUrl: authConfig.frontendUrl, secureCookies: authConfig.secureCookies,
}, createPostgresSharingStore(prisma), createImageAssetService(createPostgresAssetStore(prisma), imageConfig ? createImageKitStorage(imageConfig) : null)).listen(config.port, config.host, () => {
  console.log(`Scribble API: http://${config.host}:${config.port} (PostgreSQL via Prisma, local only)`);
  if (!authConfig.google) console.log("Google sign-in is disabled until its environment settings are configured");
  if (!imageConfig) console.log("Cloud images are disabled until backend ImageKit settings are configured");
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
