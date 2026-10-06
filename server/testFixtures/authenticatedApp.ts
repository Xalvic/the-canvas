import express from "express";
import type { Pool } from "pg";
import { createApp } from "../app.js";
import { SESSION_COOKIE, hashToken, type AuthStore } from "../auth.js";
import type { BoardStore } from "../boards.js";
import type { BoardDocumentStore } from "../documents.js";
import type { WorkspaceStore } from "../workspace.js";
import type { ImageAssetService } from "../imageAssets.js";

export const TEST_OWNER_ID = "11111111-1111-4111-8111-111111111111";
const token = "t".repeat(43);

export async function seedTestOwner(pool: Pool) {
  await pool.query("INSERT INTO users (id, google_subject, email) VALUES ($1, 'contract-test-owner', 'owner@example.com')", [TEST_OWNER_ID]);
}

// Existing contract tests use a valid session; dedicated access tests exercise
// the real application without this request wrapper.
export function createAuthenticatedApp(boards: BoardStore, documents?: BoardDocumentStore, ownerId = TEST_OWNER_ID, workspace?: WorkspaceStore, assets?: ImageAssetService) {
  const store: AuthStore = {
    async getSession(value) {
      return value === hashToken(token) ? {
        user: { id: ownerId, email: "owner@example.com", displayName: null }, expiresAt: Date.now() + 60_000,
      } : undefined;
    },
    async createFlow() { throw new Error("Unused test method"); },
    async consumeFlow() { return undefined; },
    async signIn() { throw new Error("Unused test method"); },
    async revokeSession() {},
  };
  const app = express();
  app.use((req, _res, next) => {
    req.headers.cookie = `${SESSION_COOKIE}=${token}`;
    req.headers["x-scribble-request"] = "1";
    next();
  });
  app.use(createApp(boards, documents, { store, provider: null, frontendUrl: "http://127.0.0.1:5173/scribble/", secureCookies: false }, undefined, assets, undefined, undefined, workspace));
  return app;
}
