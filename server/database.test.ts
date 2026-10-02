import { describe, expect, it } from "vitest";
import { loadDatabaseUrl } from "./database.js";

describe("database configuration", () => {
  it("accepts a PostgreSQL URL", () => {
    const DATABASE_URL = "postgresql://user:secret@127.0.0.1:5432/scribble";
    expect(loadDatabaseUrl({ DATABASE_URL })).toBe(DATABASE_URL);
  });
  it.each([undefined, "", "not-a-url", "https://user:secret@example.com/db", "postgres://localhost"])(
    "rejects missing/invalid configuration without exposing credentials", (DATABASE_URL) => {
      expect(() => loadDatabaseUrl({ DATABASE_URL })).toThrow(
        "Set DATABASE_URL to a PostgreSQL connection URL with a database name",
      );
    },
  );
});
