import fs from "fs-extra";
import path from "node:path";
import { config } from "../config.js";
import type { ClusterNode, NodesFile } from "../types/node.js";

export class NodeService {
  async ensureStore(): Promise<void> {
    await fs.ensureDir(path.dirname(config.nodesFile));
    const exists = await fs.pathExists(config.nodesFile);
    if (!exists) {
      const now = new Date().toISOString();
      const localNode: ClusterNode = {
        id: config.localNodeId,
        name: "Local Node",
        baseUrl: `http://localhost:${config.port}`,
        capabilities: ["process", "docker", "proxy"],
        labels: { region: "local", type: "dev" },
        status: "online",
        lastHeartbeatAt: now,
        createdAt: now,
        updatedAt: now
      };
      await fs.writeJson(config.nodesFile, { nodes: [localNode] } satisfies NodesFile, { spaces: 2 });
      return;
    }

    const payload = (await fs.readJson(config.nodesFile)) as NodesFile;
    const nodes = payload.nodes;
    if (!nodes.some((node) => node.id === config.localNodeId)) {
      const now = new Date().toISOString();
      nodes.push({
        id: config.localNodeId,
        name: "Local Node",
        baseUrl: `http://localhost:${config.port}`,
        capabilities: ["process", "docker", "proxy"],
        labels: { region: "local", type: "dev" },
        status: "online",
        lastHeartbeatAt: now,
        createdAt: now,
        updatedAt: now
      });
      await fs.writeJson(config.nodesFile, { nodes }, { spaces: 2 });
    }
  }

  async listNodes(): Promise<ClusterNode[]> {
    await this.ensureStore();
    const payload = (await fs.readJson(config.nodesFile)) as NodesFile;
    return payload.nodes;
  }

  async writeNodes(nodes: ClusterNode[]): Promise<void> {
    await fs.writeJson(config.nodesFile, { nodes }, { spaces: 2 });
  }

  async upsertNode(input: Omit<ClusterNode, "createdAt" | "updatedAt" | "status" | "lastHeartbeatAt">): Promise<ClusterNode> {
    const nodes = await this.listNodes();
    const now = new Date().toISOString();
    const existingIndex = nodes.findIndex((node) => node.id === input.id);
    const node: ClusterNode = {
      ...input,
      status: "online",
      lastHeartbeatAt: now,
      createdAt: existingIndex >= 0 ? nodes[existingIndex].createdAt : now,
      updatedAt: now
    };
    if (existingIndex >= 0) nodes[existingIndex] = node;
    else nodes.push(node);
    await this.writeNodes(nodes);
    return node;
  }

  async heartbeat(id: string): Promise<ClusterNode> {
    const nodes = await this.listNodes();
    const index = nodes.findIndex((node) => node.id === id);
    if (index < 0) throw new Error(`Node not found: ${id}`);
    const now = new Date().toISOString();
    nodes[index] = { ...nodes[index], lastHeartbeatAt: now, updatedAt: now, status: "online" };
    await this.writeNodes(nodes);
    return nodes[index];
  }
}
