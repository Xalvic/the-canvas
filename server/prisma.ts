import { PrismaPg } from "@prisma/adapter-pg";
import type { Pool } from "pg";
import { PrismaClient } from "./generated/prisma/client.js";

export function createPrismaClient(pool: Pool, schema = "public") {
  // Reuse the existing bounded pool. The caller owns it and closes it after
  // $disconnect(); test schemas must also be passed to generated ORM queries.
  const adapter = new PrismaPg(pool, { schema, disposeExternalPool: false });
  return new PrismaClient({
    adapter,
    transactionOptions: { maxWait: 5000, timeout: 10000, isolationLevel: "ReadCommitted" },
  });
}
