import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    nodesFile: `/tmp/mcp-node-test-${process.pid}/data/nodes.json`,
    localNodeId: "node-local",
    port: 4010
  }
}));

import fs from "fs-extra";
import path from "node:path";
import { NodeService } from "../node-service.js";

const TEST_DIR = `/tmp/mcp-node-test-${process.pid}`;

describe("NodeService", () => {
  let service: NodeService;

  beforeEach(async () => {
    await fs.remove(TEST_DIR);
    service = new NodeService();
  });

  afterAll(async () => {
    await fs.remove(TEST_DIR);
  });

  describe("ensureStore", () => {
    it("creates nodes.json with a local node entry", async () => {
      await service.ensureStore();
      const data = await fs.readJson(path.join(TEST_DIR, "data", "nodes.json"));
      expect(data.nodes).toHaveLength(1);
      expect(data.nodes[0].id).toBe("node-local");
    });
  });

  describe("listNodes", () => {
    it("returns the initial local node after ensureStore", async () => {
      await service.ensureStore();
      const nodes = await service.listNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].id).toBe("node-local");
    });
  });

  describe("upsertNode", () => {
    it("inserts a new node", async () => {
      await service.ensureStore();
      await service.upsertNode({ id: "node-2", name: "Remote Node", capabilities: ["process"], labels: {} });
      const nodes = await service.listNodes();
      expect(nodes).toHaveLength(2);
      expect(nodes.find((n) => n.id === "node-2")).toBeDefined();
    });

    it("updates an existing node in-place", async () => {
      await service.ensureStore();
      await service.upsertNode({ id: "node-local", name: "Updated Name", capabilities: [], labels: {} });
      const nodes = await service.listNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].name).toBe("Updated Name");
    });
  });

  describe("heartbeat", () => {
    it("updates lastHeartbeatAt for an existing node", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T10:00:00.000Z"));
      await service.ensureStore();

      vi.setSystemTime(new Date("2024-01-01T10:01:00.000Z"));
      const updated = await service.heartbeat("node-local");

      expect(updated.lastHeartbeatAt).toBe("2024-01-01T10:01:00.000Z");
      expect(updated.status).toBe("online");
      vi.useRealTimers();
    });

    it("throws 'Node not found: ...' for unknown id", async () => {
      await service.ensureStore();
      await expect(service.heartbeat("ghost-node")).rejects.toThrow("Node not found: ghost-node");
    });
  });
});
