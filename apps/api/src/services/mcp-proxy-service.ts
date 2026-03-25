import crypto from "node:crypto";
import type { ManagedServer } from "../types/server.js";
import { ProcessService } from "./process-service.js";

export interface SessionEntry {
  sessionId: string;
  serverId: string;
  createdAt: string;
  lastUsedAt: string;
  requestCount: number;
}

export interface SessionContext {
  sessionId: string;
  callerRole?: string;
  callerEmail?: string;
}

export class McpProxyService {
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(private readonly processes: ProcessService) {}

  async proxyWithSession(server: ManagedServer, payload: any, sessionContext: SessionContext): Promise<any> {
    const { sessionId, callerRole, callerEmail } = sessionContext;

    const now = new Date().toISOString();
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastUsedAt = now;
      existing.requestCount += 1;
    } else {
      this.sessions.set(sessionId, {
        sessionId,
        serverId: server.id,
        createdAt: now,
        lastUsedAt: now,
        requestCount: 1
      });
    }

    if (server.transportType === "streamable-http") {
      if (!server.remoteUrl) throw new Error("No remoteUrl configured");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-MCP-Session-Id": sessionId
      };
      if (callerRole) headers["X-MCP-Caller-Role"] = callerRole;
      if (callerEmail) headers["X-MCP-Caller-Email"] = callerEmail;

      const response = await fetch(server.remoteUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      const text = await response.text();
      if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    }

    return this.processes.sendJsonRpc(server, payload);
  }

  async proxy(server: ManagedServer, payload: any): Promise<any> {
    return this.proxyWithSession(server, payload, { sessionId: crypto.randomUUID() });
  }

  getSession(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): SessionEntry[] {
    return Array.from(this.sessions.values());
  }

  clearSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }
}
