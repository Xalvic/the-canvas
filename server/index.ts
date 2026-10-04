import { createApp } from "./app.js";
import { loadServerConfig } from "./config.js";
import { createDatabasePool, loadDatabaseUrl } from "./database.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPostgresDocumentStore } from "./postgresDocuments.js";
import { loadAuthConfig } from "./authConfig.js";
import { createGoogleAuthProvider } from "./googleAuth.js";
import { createPostgresAuthStore } from "./postgresAuth.js";

const config = loadServerConfig();
const authConfig = loadAuthConfig();
const pool = createDatabasePool(loadDatabaseUrl());
try {
  await pool.query("SELECT id, owner_id FROM boards LIMIT 0");
  await pool.query("SELECT board_id FROM board_documents LIMIT 0");
  await pool.query("SELECT id FROM users LIMIT 0");
  await pool.query("SELECT token_hash FROM auth_sessions LIMIT 0");
  await pool.query("SELECT state_hash FROM google_auth_flows LIMIT 0");
} catch {
  console.error("Could not connect to the board database. Check DATABASE_URL and run npm run db:migrate.");
  await pool.end();
  process.exit(1);
}
const server = createApp(createPostgresBoardStore(pool), createPostgresDocumentStore(pool), {
  store: createPostgresAuthStore(pool), provider: authConfig.google ? createGoogleAuthProvider(authConfig.google) : null,
  frontendUrl: authConfig.frontendUrl, secureCookies: authConfig.secureCookies,
}).listen(config.port, config.host, () => {
  console.log(`Scribble API: http://${config.host}:${config.port} (PostgreSQL, local only)`);
  if (!authConfig.google) console.log("Google sign-in is disabled until its environment settings are configured");
});

server.on("error", (error) => {
  console.error("Could not start the API:", error.message);
  process.exitCode = 1;
  void pool.end();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => { void pool.end(); });
  });
}
