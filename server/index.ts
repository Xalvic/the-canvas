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
import { createPostgresCollaborationStore } from "./postgresCollaboration.js";
import { loadProductionConfig } from "./productionConfig.js";
import { createPostgresRequestBudgets } from "./productionBudgets.js";
import { createPostgresWorkspaceStore } from "./postgresWorkspace.js";
import { createPostgresShareLinkStore } from "./postgresShareLinks.js";
import { loadShareLinkKey } from "./shareLinkCrypto.js";

const config = loadServerConfig();
const production = loadProductionConfig();
const authConfig = loadAuthConfig();
const imageConfig = loadImageKitConfig();
const shareLinkKey = loadShareLinkKey();
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
  await prisma.$queryRaw`SELECT upload_request_id, upload_content_hash, upload_lease_token, upload_lease_until, upload_attempts FROM board_assets LIMIT 0`;
  await prisma.$queryRaw`SELECT bucket FROM asset_request_budgets LIMIT 0`;
  await prisma.$queryRaw`SELECT operation_id FROM board_operation_receipts LIMIT 0`;
  await prisma.$queryRaw`SELECT board_id FROM board_share_links LIMIT 0`;
  await prisma.$queryRaw`SELECT board_id FROM board_share_link_grants LIMIT 0`;
  await prisma.$queryRaw`SELECT request_id FROM board_share_link_receipts LIMIT 0`;
  if (production) await prisma.$queryRaw`SELECT bucket FROM api_request_budgets LIMIT 0`;
} catch {
  console.error("Could not connect to the board database. Check DATABASE_URL and run npm run db:migrate.");
  await closeDatabase();
  process.exit(1);
}
const server = createApp(createPostgresBoardStore(prisma), createPostgresDocumentStore(prisma), {
  store: createPostgresAuthStore(prisma), provider: authConfig.google ? createGoogleAuthProvider(authConfig.google) : null,
  frontendUrl: authConfig.frontendUrl, secureCookies: authConfig.secureCookies,
}, createPostgresSharingStore(prisma), createImageAssetService(createPostgresAssetStore(prisma), imageConfig ? createImageKitStorage(imageConfig) : null), createPostgresCollaborationStore(prisma), production ? {
  proxySecret: production.proxySecret, budgets: createPostgresRequestBudgets(pool, production.proxySecret),
  ready: async () => {
    // pg supports query_timeout at runtime; its public QueryConfig type omits it.
    const probe = { text: "SELECT 1", query_timeout: 1800 };
    await pool.query(probe);
  },
} : undefined, createPostgresWorkspaceStore(prisma), shareLinkKey ? createPostgresShareLinkStore(prisma, shareLinkKey) : undefined).listen(config.port, config.host, () => {
  console.log(`Scribble API listening on ${config.host}:${config.port} (${production ? "production origin guard enabled" : "development"})`);
  if (!authConfig.google) console.log("Google sign-in is disabled until its environment settings are configured");
  if (!imageConfig) console.log("Cloud images are disabled until backend ImageKit settings are configured");
  if (!shareLinkKey) console.log("Reusable link sharing is disabled until SHARE_LINK_KEY is configured");
});

server.on("error", (error) => {
  console.error("Could not start the API:", error.message);
  process.exitCode = 1;
  void closeDatabase();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    // Live SSE responses do not end themselves while the board stays open.
    const deadline = setTimeout(() => server.closeAllConnections(), 5_000);
    deadline.unref();
    server.close(() => { clearTimeout(deadline); void closeDatabase(); });
  });
}
