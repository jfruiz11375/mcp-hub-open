import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    agentsFile: `/tmp/mcp-agent-test-${process.pid}/data/agents.json`,
    jwtSecret: "test-jwt-secret-for-tests-only"
  }
}));

import fs from "fs-extra";
import path from "node:path";
import { AgentService } from "../agent-service.js";

const TEST_DIR = `/tmp/mcp-agent-test-${process.pid}`;

describe("AgentService", () => {
  let service: AgentService;

  beforeEach(async () => {
    await fs.remove(TEST_DIR);
    service = new AgentService();
  });

  afterAll(async () => {
    await fs.remove(TEST_DIR);
  });

  describe("ensureStore", () => {
    it("creates agents.json with an empty agents array", async () => {
      await service.ensureStore();
      const data = await fs.readJson(path.join(TEST_DIR, "data", "agents.json"));
      expect(data.agents).toEqual([]);
    });

    it("does not overwrite an existing store", async () => {
      await service.ensureStore();
      const { agent } = await service.createAgent({ name: "test", nodeId: "node-1" });
      await service.ensureStore(); // second call should not reset
      const agents = await service.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe(agent.id);
    });
  });

  describe("createAgent", () => {
    it("returns an agent record and a JWT token", async () => {
      const { agent, token } = await service.createAgent({ name: "worker-1", nodeId: "node-1" });
      expect(agent.id).toMatch(/^agent-[0-9a-f]{16}$/);
      expect(agent.name).toBe("worker-1");
      expect(agent.nodeId).toBe("node-1");
      expect(agent.status).toBe("active");
      expect(agent.revoked).toBe(false);
      expect(agent.lastHeartbeatAt).toBeNull();
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3); // JWT structure
    });

    it("uses provided capabilities and labels", async () => {
      const { agent } = await service.createAgent({
        name: "worker-2",
        nodeId: "node-2",
        capabilities: ["execute", "logs"],
        labels: { region: "us-east" }
      });
      expect(agent.capabilities).toEqual(["execute", "logs"]);
      expect(agent.labels).toEqual({ region: "us-east" });
    });

    it("defaults to [execute] capability when none provided", async () => {
      const { agent } = await service.createAgent({ name: "worker-3", nodeId: "node-3" });
      expect(agent.capabilities).toEqual(["execute"]);
    });

    it("persists the agent in the store", async () => {
      await service.createAgent({ name: "worker-1", nodeId: "node-1" });
      const agents = await service.listAgents();
      expect(agents).toHaveLength(1);
    });
  });

  describe("listAgents", () => {
    it("returns empty array before any agents are created", async () => {
      const agents = await service.listAgents();
      expect(agents).toEqual([]);
    });

    it("returns all created agents", async () => {
      await service.createAgent({ name: "a1", nodeId: "n1" });
      await service.createAgent({ name: "a2", nodeId: "n2" });
      const agents = await service.listAgents();
      expect(agents).toHaveLength(2);
    });
  });

  describe("revokeAgent", () => {
    it("marks the agent as revoked", async () => {
      const { agent } = await service.createAgent({ name: "revokable", nodeId: "node-1" });
      const revoked = await service.revokeAgent(agent.id);
      expect(revoked.revoked).toBe(true);
      expect(revoked.status).toBe("revoked");
    });

    it("persists the revoked state", async () => {
      const { agent } = await service.createAgent({ name: "revokable", nodeId: "node-1" });
      await service.revokeAgent(agent.id);
      const agents = await service.listAgents();
      expect(agents[0].revoked).toBe(true);
    });

    it("throws 'Agent not found: ...' for unknown id", async () => {
      await expect(service.revokeAgent("unknown-id")).rejects.toThrow("Agent not found: unknown-id");
    });
  });

  describe("deleteAgent", () => {
    it("removes the agent from the store", async () => {
      const { agent } = await service.createAgent({ name: "deletable", nodeId: "node-1" });
      await service.deleteAgent(agent.id);
      const agents = await service.listAgents();
      expect(agents).toHaveLength(0);
    });

    it("throws 'Agent not found: ...' for unknown id", async () => {
      await expect(service.deleteAgent("ghost-id")).rejects.toThrow("Agent not found: ghost-id");
    });
  });

  describe("heartbeat", () => {
    it("updates lastHeartbeatAt for an active agent", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T10:00:00.000Z"));
      const { token } = await service.createAgent({ name: "heartbeat-agent", nodeId: "node-1" });

      vi.setSystemTime(new Date("2024-01-01T10:01:00.000Z"));
      const updated = await service.heartbeat(token);

      expect(updated.lastHeartbeatAt).toBe("2024-01-01T10:01:00.000Z");
      expect(updated.status).toBe("active");
      vi.useRealTimers();
    });

    it("throws on invalid token", async () => {
      await expect(service.heartbeat("not.a.valid.token")).rejects.toThrow("Invalid agent token");
    });

    it("throws on a revoked agent token", async () => {
      const { agent, token } = await service.createAgent({ name: "revoked-agent", nodeId: "node-1" });
      await service.revokeAgent(agent.id);
      await expect(service.heartbeat(token)).rejects.toThrow("Agent token has been revoked");
    });
  });

  describe("dispatch", () => {
    it("returns a dispatched result for an active agent", async () => {
      const { agent } = await service.createAgent({ name: "dispatch-agent", nodeId: "node-1" });
      const result = await service.dispatch(agent.id, { command: "echo hello" });
      expect(result.agentId).toBe(agent.id);
      expect(result.command).toBe("echo hello");
      expect(result.status).toBe("dispatched");
      expect(typeof result.dispatchedAt).toBe("string");
    });

    it("throws for unknown agent id", async () => {
      await expect(service.dispatch("ghost", { command: "echo" })).rejects.toThrow("Agent not found: ghost");
    });

    it("throws when agent is revoked", async () => {
      const { agent } = await service.createAgent({ name: "revoked", nodeId: "node-1" });
      await service.revokeAgent(agent.id);
      await expect(service.dispatch(agent.id, { command: "echo" })).rejects.toThrow("Agent is revoked");
    });
  });

  describe("verifyAgentToken", () => {
    it("returns agent record for a valid token", async () => {
      const { agent, token } = await service.createAgent({ name: "verify-agent", nodeId: "node-1" });
      const verified = await service.verifyAgentToken(token);
      expect(verified.id).toBe(agent.id);
    });

    it("throws for an invalid token", async () => {
      await expect(service.verifyAgentToken("bad.token.here")).rejects.toThrow("Invalid agent token");
    });

    it("throws for a revoked agent", async () => {
      const { agent, token } = await service.createAgent({ name: "revoked-verify", nodeId: "node-1" });
      await service.revokeAgent(agent.id);
      await expect(service.verifyAgentToken(token)).rejects.toThrow("Agent token has been revoked");
    });
  });
});
