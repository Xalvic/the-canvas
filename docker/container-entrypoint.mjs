// Keep the host .env.docker connection/password intact. Compose containers use
// their service DNS name and internal port while retaining encoded credentials.
const commands = {
  server: "../dist-server/index.js",
  migrate: "../dist-server/migrate.js",
  cleanup: "../dist-server/cleanupAssets.js",
};
const command = process.argv[2] ?? "server";
if (!Object.hasOwn(commands, command)) {
  console.error("Use server, migrate or cleanup as the container command");
  process.exit(1);
}
try {
  if (process.env.CONTAINER_DATABASE_HOST) {
    const url = new URL(process.env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
    url.hostname = process.env.CONTAINER_DATABASE_HOST;
    url.port = process.env.CONTAINER_DATABASE_PORT ?? "5432";
    process.env.DATABASE_URL = url.href;
  }
  await import(commands[command]);
} catch {
  console.error("Container command failed. Check backend configuration and database availability.");
  process.exitCode = 1;
}
