import { createHmac } from "node:crypto";
import type { Pool } from "pg";

export type RequestBudget = { allowed: boolean; retryAfter: number };
export type BudgetStore = { consume(scope: string, identity: string, limit: number, windowSeconds: number): Promise<RequestBudget> };

export function createPostgresRequestBudgets(pool: Pool, secret: string, capacity = 100_000): BudgetStore {
  return {
    async consume(scope, identity, limit, windowSeconds) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 3600) {
        throw new Error("Invalid request budget policy");
      }
      const bucket = createHmac("sha256", secret).update(JSON.stringify([scope, identity])).digest("hex");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Bound admission across all replicas, including concurrent new IPs. This
        // lock is held only for short budget queries, never the API operation.
        await client.query("SET LOCAL statement_timeout = '2000ms'");
        await client.query("SELECT pg_advisory_xact_lock(734621002)");
        await client.query("DELETE FROM api_request_budgets WHERE expires_at <= clock_timestamp()");
        const existing = await client.query<{ request_count: number; retry_after: number }>(
          "SELECT request_count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM expires_at-clock_timestamp())))::int AS retry_after FROM api_request_budgets WHERE bucket=$1", [bucket]);
        let result: RequestBudget;
        if (existing.rows[0]) {
          const value = existing.rows[0];
          result = { allowed: value.request_count < limit, retryAfter: value.retry_after };
          if (result.allowed) await client.query("UPDATE api_request_budgets SET request_count=request_count+1 WHERE bucket=$1", [bucket]);
        } else {
          const count = await client.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM api_request_budgets");
          result = { allowed: count.rows[0]!.count < capacity, retryAfter: windowSeconds };
          if (result.allowed) await client.query("INSERT INTO api_request_budgets(bucket,request_count,expires_at) VALUES($1,1,clock_timestamp()+make_interval(secs => $2))", [bucket, windowSeconds]);
        }
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
  };
}
