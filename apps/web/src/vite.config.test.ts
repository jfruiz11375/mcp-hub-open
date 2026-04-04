// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function isBasicSslPlugin(plugin: unknown): boolean {
  if (plugin == null || typeof plugin !== "object") return false;
  const name = (plugin as Record<string, unknown>).name;
  return typeof name === "string" && name.toLowerCase().includes("ssl");
}

describe("vite.config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("includes basic-ssl plugin", async () => {
    const { default: config } = await import("../vite.config");
    const plugins = (config.plugins as unknown[]).flat(Infinity);
    expect(plugins.some(isBasicSslPlugin)).toBe(true);
  });

  it("server.https is enabled", async () => {
    const { default: config } = await import("../vite.config");
    expect(config.server?.https).toEqual({});
  });

  it("server.port defaults to 5173 when WEB_PORT is not set", async () => {
    vi.resetModules();
    delete process.env["WEB_PORT"];
    const { default: config } = await import("../vite.config");
    expect(config.server?.port).toBe(5173);
  });

  it("server.port reads from WEB_PORT env var", async () => {
    vi.stubEnv("WEB_PORT", "3000");
    const { default: config } = await import("../vite.config");
    expect(config.server?.port).toBe(3000);
  });

  it("server.proxy /api target contains 4010 by default", async () => {
    delete process.env["API_PORT"];
    const { default: config } = await import("../vite.config");
    const proxy = config.server?.proxy as Record<string, { target: string; changeOrigin: boolean }>;
    expect(proxy["/api"].target).toContain("4010");
  });

  it("server.proxy /api changeOrigin is true", async () => {
    const { default: config } = await import("../vite.config");
    const proxy = config.server?.proxy as Record<string, { target: string; changeOrigin: boolean }>;
    expect(proxy["/api"].changeOrigin).toBe(true);
  });
});
