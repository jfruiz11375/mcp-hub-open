export type AgentStatus = "active" | "inactive" | "revoked";

export interface AgentRecord {
  id: string;
  name: string;
  nodeId: string;
  token: string;
  status: AgentStatus;
  capabilities: string[];
  labels: Record<string, string>;
  revoked: boolean;
  createdAt: string;
  updatedAt: string;
  lastHeartbeatAt: string | null;
}

export interface AgentsFile {
  agents: AgentRecord[];
}

export interface DispatchRequest {
  command: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface DispatchResult {
  agentId: string;
  command: string;
  status: "dispatched";
  dispatchedAt: string;
}
