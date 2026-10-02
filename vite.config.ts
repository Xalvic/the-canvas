import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const apiTarget = `http://127.0.0.1:${process.env.API_PORT ?? "3001"}`;

export default defineConfig({
  base: "/scribble/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: { "/api": apiTarget, "/health": apiTarget },
  },
  test: { include: ["src/**/*.test.ts", "server/**/*.test.ts"] },
});
