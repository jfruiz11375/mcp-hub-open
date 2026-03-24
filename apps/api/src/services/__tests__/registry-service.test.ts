import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    dataDir: `/tmp/mcp-registry-test-${process.pid}`,
    dataFile: `/tmp/mcp-registry-test-${process.pid}/data/servers.json`,
    reposDir: `/tmp/mcp-registry-test-${process.pid}/repos`,
    logsDir: `/tmp/mcp-registry-test-${process.pid}/logs`,
    vaultMasterKey: "test-master-key-for-unit-tests"
  }
}));

import fs from "fs-extra";
import { RegistryService } from "../registry-service.js";
import type { ManagedServer } from "../../types/server.js";

const TEST_DIR = `/tmp/mcp-registry-test-${process.pid}`;

function makeServer(overrides: Partial<ManagedServer> = {}): ManagedServer {
  return {
    id: "server-1",
    name: "Test Server",
    runtimeKind: "node",
    transportType: "stdio",
    env: [],
    status: "stopped",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("RegistryService", () => {
  let service: RegistryService;

  beforeEach(async () => {
    await fs.remove(TEST_DIR);
    service = new RegistryService();
  });

  afterAll(async () => {
    await fs.remove(TEST_DIR);
  });

  describe("ensureStore", () => {
    it("creates the servers.json file with an empty servers array", async () => {
      await service.ensureStore();
      const data = await fs.readJson(`${TEST_DIR}/data/servers.json`);
      expect(data.servers).toEqual([]);
    });
  });

  describe("create", () => {
    it("adds a server and returns the sanitized form", async () => {
      const server = makeServer({ env: [{ key: "API_KEY", value: "secret", secret: true }] });
      const created = await service.create(server);
      expect(created.id).toBe("server-1");
      expect(created.env[0].value).toBe("********");
    });
  });

  describe("readAll", () => {
    it("returns all sanitized servers", async () => {
      await service.create(makeServer({ id: "s1" }));
      await service.create(makeServer({ id: "s2" }));
      const servers = await service.readAll();
      expect(servers).toHaveLength(2);
      expect(servers.map((s) => s.id)).toEqual(expect.arrayContaining(["s1", "s2"]));
    });
  });

  describe("getById", () => {
    it("returns the sanitized server by id", async () => {
      await service.create(makeServer({ id: "find-me" }));
      const server = await service.getById("find-me");
      expect(server).toBeDefined();
      expect(server!.id).toBe("find-me");
    });

    it("returns undefined for unknown id", async () => {
      await service.ensureStore();
      const server = await service.getById("does-not-exist");
      expect(server).toBeUndefined();
    });
  });

  describe("update", () => {
    it("applies patch and updates updatedAt", async () => {
      await service.create(makeServer({ id: "upd-1", name: "Old Name" }));
      const updated = await service.update("upd-1", { name: "New Name" });
      expect(updated.name).toBe("New Name");
      expect(updated.updatedAt).toBeDefined();
    });

    it("throws 'Server not found: ...' for unknown id", async () => {
      await service.ensureStore();
      await expect(service.update("no-such-id", { name: "X" })).rejects.toThrow("Server not found: no-such-id");
    });
  });

  describe("remove", () => {
    it("deletes the server by id", async () => {
      await service.create(makeServer({ id: "rm-1" }));
      await service.remove("rm-1");
      const server = await service.getById("rm-1");
      expect(server).toBeUndefined();
    });
  });

  describe("sanitize", () => {
    it("masks non-empty secret env values with ********", () => {
      const server = makeServer({
        env: [
          { key: "SECRET", value: "mysecret", secret: true },
          { key: "HOST", value: "localhost", secret: false }
        ]
      });
      const sanitized = service.sanitize(server);
      expect(sanitized.env[0].value).toBe("********");
      expect(sanitized.env[1].value).toBe("localhost");
    });
  });

  describe("withEncryptedSecrets / withDecryptedSecrets", () => {
    it("round-trips secret env values correctly", () => {
      const server = makeServer({ env: [{ key: "TOKEN", value: "my-secret-token", secret: true }] });
      const encrypted = service.withEncryptedSecrets(server);
      expect(encrypted.env[0].value).not.toBe("my-secret-token");
      const decrypted = service.withDecryptedSecrets(encrypted);
      expect(decrypted.env[0].value).toBe("my-secret-token");
    });
  });
});
