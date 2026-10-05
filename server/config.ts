import { z } from "zod";

const portSchema = z.coerce.number().int().min(1).max(65535).default(3001);
const hostSchema = z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1");

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    // Host development remains loopback; Docker explicitly binds its network interface.
    host: hostSchema.parse(env.API_HOST),
    port: portSchema.parse(env.API_PORT),
  };
}
