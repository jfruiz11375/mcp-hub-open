export type NodeStatus = "online" | "offline";

export interface ClusterNode {
  id: string;
  name: string;
  baseUrl?: string;
  capabilities: string[];
  labels: Record<string, string>;
  status: NodeStatus;
  lastHeartbeatAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface NodesFile {
  nodes: ClusterNode[];
}
