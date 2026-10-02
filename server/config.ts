import { z } from "zod";

const portSchema = z.coerce.number().int().min(1).max(65535).default(3001);

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    // This unauthenticated prototype is only reachable from this machine.
    host: "127.0.0.1",
    port: portSchema.parse(env.API_PORT),
  };
}
