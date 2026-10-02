import pg from "pg";

export function loadDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DATABASE_URL;
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
      throw new Error();
    }
    return value;
  } catch {
    // Never include a connection string/password in configuration errors.
    throw new Error("Set DATABASE_URL to a PostgreSQL connection URL with a database name");
  }
}

export function createDatabasePool(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
  pool.on("error", () => console.error("An idle PostgreSQL connection failed"));
  return pool;
}
