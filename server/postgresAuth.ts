import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AuthStore, AuthUser } from "./auth.js";

type UserRow = { id: string; email: string; display_name: string | null };
function user(row: UserRow): AuthUser { return { id: row.id, email: row.email, displayName: row.display_name }; }

export function createPostgresAuthStore(pool: Pool): AuthStore {
  return {
    async createFlow(flow) {
      await pool.query("DELETE FROM google_auth_flows WHERE expires_at <= clock_timestamp()");
      await pool.query(
        "INSERT INTO google_auth_flows (state_hash, browser_hash, nonce, code_verifier) VALUES ($1, $2, $3, $4)",
        [flow.stateHash, flow.browserHash, flow.nonce, flow.codeVerifier],
      );
    },
    async consumeFlow(stateHash, browserHash) {
      // A single conditional DELETE allows one callback only, including races.
      const result = await pool.query<{ nonce: string; code_verifier: string }>(
        "DELETE FROM google_auth_flows WHERE state_hash = $1 AND browser_hash = $2 AND expires_at > clock_timestamp() RETURNING nonce, code_verifier",
        [stateHash, browserHash],
      );
      const row = result.rows[0];
      return row ? { nonce: row.nonce, codeVerifier: row.code_verifier } : undefined;
    },
    async signIn(identity, tokenHash, previousTokenHash) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Google subject is the identity key. Email changes never create/link users.
        const result = await client.query<UserRow>(
          `INSERT INTO users (id, google_subject, email, display_name) VALUES ($1, $2, $3, $4)
           ON CONFLICT (google_subject) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name
           RETURNING id, email, display_name`,
          [randomUUID(), identity.subject, identity.email, identity.displayName],
        );
        if (previousTokenHash) await client.query("DELETE FROM auth_sessions WHERE token_hash = $1", [previousTokenHash]);
        await client.query("DELETE FROM auth_sessions WHERE expires_at <= clock_timestamp()");
        const session = await client.query<{ expires_at: Date }>(
          "INSERT INTO auth_sessions (token_hash, user_id) VALUES ($1, $2) RETURNING expires_at",
          [tokenHash, result.rows[0].id],
        );
        await client.query("COMMIT");
        return { user: user(result.rows[0]), expiresAt: session.rows[0].expires_at.getTime() };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
    async getSession(tokenHash) {
      const result = await pool.query<UserRow & { expires_at: Date }>(
        `SELECT u.id, u.email, u.display_name, s.expires_at FROM auth_sessions s
         JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > clock_timestamp()`,
        [tokenHash],
      );
      const row = result.rows[0];
      return row ? { user: user(row), expiresAt: row.expires_at.getTime() } : undefined;
    },
    async revokeSession(tokenHash) { await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash]); },
  };
}
