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
  it("allows the explicit container network bind while preserving host defaults", () => {
    expect(loadServerConfig({ API_HOST: "0.0.0.0" })).toEqual({ host: "0.0.0.0", port: 3001 });
  });
  it.each(["", "localhost", "192.168.1.1", "http://0.0.0.0", "::"])("rejects unsupported API_HOST %j", (API_HOST) => {
    expect(() => loadServerConfig({ API_HOST })).toThrow();
  });
});
