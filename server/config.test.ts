import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config.js";

describe("server configuration", () => {
  it("defaults to loopback and accepts a valid configured port", () => {
    expect(loadServerConfig({})).toEqual({ host: "127.0.0.1", port: 3001 });
    expect(loadServerConfig({ API_PORT: "3456" }).port).toBe(3456);
  });

  it.each(["", "0", "-1", "65536", "3001.5", "invalid"])(
    "rejects invalid API_PORT %j before listening",
    (API_PORT) => expect(() => loadServerConfig({ API_PORT })).toThrow(),
  );
});
