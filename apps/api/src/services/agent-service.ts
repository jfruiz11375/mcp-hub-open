import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import { config } from "../config.js";
import { AuthService } from "./auth-service.js";
import type { AgentRecord, AgentsFile, DispatchRequest, DispatchResult } from "../types/agent.js";

export class AgentService {
  private auth = new AuthService();

  async ensureStore(): Promise<void> {
    await fs.ensureDir(path.dirname(config.agentsFile));
    const exists = await fs.pathExists(config.agentsFile);
    if (!exists) {
      await fs.writeJson(config.agentsFile, { agents: [] } satisfies AgentsFile, { spaces: 2 });
    }
  }

  private async readAgents(): Promise<AgentRecord[]> {
    await this.ensureStore();
    const data = (await fs.readJson(config.agentsFile)) as AgentsFile;
    return data.agents;
  }

  private async writeAgents(agents: AgentRecord[]): Promise<void> {
    await fs.writeJson(config.agentsFile, { agents }, { spaces: 2 });
  }

  async listAgents(): Promise<AgentRecord[]> {
    return this.readAgents();
  }

  async createAgent(input: {
    name: string;
    nodeId: string;
    capabilities?: string[];
    labels?: Record<string, string>;
  }): Promise<{ agent: AgentRecord; token: string }> {
    const agents = await this.readAgents();
    const id = `agent-${crypto.randomBytes(8).toString("hex")}`;
    const token = this.auth.issueAgentToken(id);
    const now = new Date().toISOString();
    const agent: AgentRecord = {
      id,
      name: input.name,
      nodeId: input.nodeId,
      token,
      status: "active",
      capabilities: input.capabilities ?? ["execute"],
      labels: input.labels ?? {},
      revoked: false,
      createdAt: now,
      updatedAt: now,
      lastHeartbeatAt: null
    };
    agents.push(agent);
    await this.writeAgents(agents);
    return { agent, token };
  }

  async revokeAgent(id: string): Promise<AgentRecord> {
    const agents = await this.readAgents();
    const index = agents.findIndex((a) => a.id === id);
    if (index < 0) throw new Error(`Agent not found: ${id}`);
    const now = new Date().toISOString();
    agents[index] = { ...agents[index], revoked: true, status: "revoked", updatedAt: now };
    await this.writeAgents(agents);
    return agents[index];
  }

  async deleteAgent(id: string): Promise<void> {
    const agents = await this.readAgents();
    const index = agents.findIndex((a) => a.id === id);
    if (index < 0) throw new Error(`Agent not found: ${id}`);
    agents.splice(index, 1);
    await this.writeAgents(agents);
  }

  async heartbeat(token: string): Promise<AgentRecord> {
    const agent = await this.verifyAgentToken(token);
    const agents = await this.readAgents();
    const index = agents.findIndex((a) => a.id === agent.id);
    const now = new Date().toISOString();
    agents[index] = { ...agents[index], lastHeartbeatAt: now, status: "active", updatedAt: now };
    await this.writeAgents(agents);
    return agents[index];
  }

  async dispatch(id: string, request: DispatchRequest): Promise<DispatchResult> {
    const agents = await this.readAgents();
    const agent = agents.find((a) => a.id === id);
    if (!agent) throw new Error(`Agent not found: ${id}`);
    if (agent.revoked) throw new Error("Agent is revoked");
    if (agent.status !== "active") throw new Error("Agent is not active");
    return {
      agentId: id,
      command: request.command,
      status: "dispatched",
      dispatchedAt: new Date().toISOString()
    };
  }

  async verifyAgentToken(token: string): Promise<AgentRecord> {
    let payload: Record<string, any>;
    try {
      payload = this.auth.verifyToken(token);
    } catch {
      throw new Error("Invalid agent token");
    }
    if (payload.type !== "agent" || typeof payload.sub !== "string") {
      throw new Error("Invalid agent token");
    }
    const agents = await this.readAgents();
    const agent = agents.find((a) => a.id === payload.sub);
    if (!agent) throw new Error(`Agent not found: ${payload.sub}`);
    if (agent.revoked) throw new Error("Agent token has been revoked");
    return agent;
  }
}
