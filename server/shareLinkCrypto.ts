import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { hashToken, tokenSchema } from "./auth.js";
import { HttpError } from "./errors.js";

export function loadShareLinkKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  if (!env.SHARE_LINK_KEY) return null;
  if (!/^[a-fA-F0-9]{64}$/.test(env.SHARE_LINK_KEY)) throw new Error("SHARE_LINK_KEY must be a backend-only 32-byte hexadecimal key");
  return Buffer.from(env.SHARE_LINK_KEY, "hex");
}

export function createShareLinkCrypto(key: Buffer) {
  if (key.length !== 32) throw new Error("A 32-byte share-link key is required");
  const secret = Buffer.from(key);
  const aad = (boardId: string, generation: number) => Buffer.from(`scribble-share-link:1:${boardId}:${generation}`);
  return {
    protect(token: string, boardId: string, generation: number) {
      tokenSchema.parse(token);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", secret, iv);
      cipher.setAAD(aad(boardId, generation));
      const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("hex");
    },
    recover(ciphertext: string, digest: string, boardId: string, generation: number) {
      try {
        if (!/^[a-f0-9]{142}$/.test(ciphertext)) throw new Error();
        const bytes = Buffer.from(ciphertext, "hex");
        const cipher = createDecipheriv("aes-256-gcm", secret, bytes.subarray(0, 12));
        cipher.setAAD(aad(boardId, generation));
        cipher.setAuthTag(bytes.subarray(12, 28));
        const token = Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
        if (!tokenSchema.safeParse(token).success || hashToken(token) !== digest) throw new Error();
        return token;
      } catch {
        throw new HttpError(503, "SHARE_LINK_KEY_UNAVAILABLE", "The active link cannot be copied. Check the server key or stop sharing before creating a new link");
      }
    },
  };
}
