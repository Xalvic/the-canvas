import { randomUUID } from "node:crypto";
import type { PrismaClient } from "./generated/prisma/client.js";
import type { AuthStore, AuthUser } from "./auth.js";

const userSelect = { id: true, email: true, displayName: true } as const;

export function createPostgresAuthStore(prisma: PrismaClient): AuthStore {
  return {
    async createFlow(flow) {
      await prisma.$executeRaw`DELETE FROM google_auth_flows WHERE expires_at <= clock_timestamp()`;
      await prisma.googleAuthFlow.create({ data: flow });
    },
    async consumeFlow(stateHash, browserHash) {
      // A single conditional DELETE allows one callback only, including races.
      const rows = await prisma.$queryRaw<{ nonce: string; codeVerifier: string }[]>`
        DELETE FROM google_auth_flows
        WHERE state_hash = ${stateHash} AND browser_hash = ${browserHash} AND expires_at > clock_timestamp()
        RETURNING nonce, code_verifier AS "codeVerifier"
      `;
      return rows[0];
    },
    async signIn(identity, tokenHash, previousTokenHash) {
      return prisma.$transaction(async (tx) => {
        // Google subject is the identity key. Email changes never create/link users.
        const user = await tx.user.upsert({
          where: { googleSubject: identity.subject },
          create: { id: randomUUID(), googleSubject: identity.subject, email: identity.email, displayName: identity.displayName },
          update: { email: identity.email, displayName: identity.displayName },
          select: userSelect,
        });
        if (previousTokenHash) await tx.authSession.deleteMany({ where: { tokenHash: previousTokenHash } });
        await tx.$executeRaw`DELETE FROM auth_sessions WHERE expires_at <= clock_timestamp()`;
        const session = await tx.authSession.create({
          data: { tokenHash, userId: user.id }, select: { expiresAt: true },
        });
        return { user, expiresAt: session.expiresAt.getTime() };
      });
    },
    async getSession(tokenHash) {
      const rows = await prisma.$queryRaw<(AuthUser & { expiresAt: Date })[]>`
        SELECT u.id, u.email, u.display_name AS "displayName", s.expires_at AS "expiresAt" FROM auth_sessions s
        JOIN users u ON u.id = s.user_id WHERE s.token_hash = ${tokenHash} AND s.expires_at > clock_timestamp()
      `;
      const row = rows[0];
      return row ? { user: { id: row.id, email: row.email, displayName: row.displayName }, expiresAt: row.expiresAt.getTime() } : undefined;
    },
    async revokeSession(tokenHash) { await prisma.authSession.deleteMany({ where: { tokenHash } }); },
  };
}
