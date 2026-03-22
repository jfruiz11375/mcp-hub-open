import type { ManagedServer } from "../types/server.js";
import { ProcessService } from "./process-service.js";

export class McpProxyService {
  constructor(private readonly processes: ProcessService) {}

  async proxy(server: ManagedServer, payload: any): Promise<any> {
    if (server.transportType === "streamable-http") {
      if (!server.remoteUrl) throw new Error("No remoteUrl configured");
      const response = await fetch(server.remoteUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
}
