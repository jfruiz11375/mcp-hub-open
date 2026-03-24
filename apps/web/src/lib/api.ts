export type RuntimeKind = "node" | "python" | "docker" | "remote";
export type TransportType = "stdio" | "streamable-http";
export type ServerStatus = "draft" | "stopped" | "starting" | "running" | "error";
export type IsolationMode = "process" | "docker";
export type VerificationMode = "none" | "checksum" | "signature";

export interface EnvVarField {
  key: string;
  value: string;
  secret?: boolean;
}

export interface ManagedServer {
  id: string;
  name: string;
  description?: string;
  repoUrl?: string;
  branch?: string;
  subdirectory?: string;
  runtimeKind: RuntimeKind;
  transportType: TransportType;
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  workingDirectory?: string;
  remoteUrl?: string;
  env: EnvVarField[];
  status: ServerStatus;
  createdAt: string;
  updatedAt: string;
  installedPath?: string;
  pid?: number;
  lastInstalledAt?: string;
  lastStartedAt?: string;
  lastStoppedAt?: string;
  lastError?: string;
  targetNodeId?: string;
  isolation?: {
    mode: IsolationMode;
    dockerImage?: string;
    dockerNetwork?: string;
  };
  packageVerification?: {
    mode: VerificationMode;
    targetPath?: string;
    expectedSha256?: string;
    manifestPath?: string;
    signaturePath?: string;
    publicKeyPem?: string;
  };
}

export interface ClusterNode {
  id: string;
  name: string;
  baseUrl?: string;
  capabilities: string[];
  labels: Record<string, string>;
  status: "online" | "offline";
  lastHeartbeatAt: string;
}

const baseUrl = "";
let token: string | null = null;

export function setToken(value: string | null) {
  token = value;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined)
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${baseUrl}${path}`, {
    headers,
    ...init
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error || response.statusText);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean; authRequired: boolean }>("/api/health"),
  providers: () => request<{ local: boolean; oidc: boolean }>("/api/auth/providers"),
  login: (email: string, password: string) =>
    request<{ token: string; user: { email: string; name: string; role: string } }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }),
  listServers: () => request<ManagedServer[]>("/api/servers"),
  createServer: (payload: Omit<ManagedServer, "status" | "createdAt" | "updatedAt">) =>
    request<ManagedServer>("/api/servers", { method: "POST", body: JSON.stringify(payload) }),
  installServer: (id: string) => request(`/api/servers/${id}/install`, { method: "POST" }),
  startServer: (id: string) => request(`/api/servers/${id}/start`, { method: "POST" }),
  stopServer: (id: string) => request(`/api/servers/${id}/stop`, { method: "POST" }),
  getLogs: (id: string) => request<{ id: string; log: string }>(`/api/servers/${id}/logs`),
  listNodes: () => request<ClusterNode[]>("/api/nodes")
};
