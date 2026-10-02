import { createApp } from "./app.js";
import { loadServerConfig } from "./config.js";
import { createDatabasePool, loadDatabaseUrl } from "./database.js";
import { createPostgresBoardStore } from "./postgresBoards.js";

const config = loadServerConfig();
const pool = createDatabasePool(loadDatabaseUrl());
try {
  await pool.query("SELECT id FROM boards LIMIT 0");
} catch {
  console.error("Could not connect to the board database. Check DATABASE_URL and run npm run db:migrate.");
  await pool.end();
  process.exit(1);
}
const server = createApp(createPostgresBoardStore(pool)).listen(config.port, config.host, () => {
  console.log(`Scribble API: http://${config.host}:${config.port} (PostgreSQL, local only)`);
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
