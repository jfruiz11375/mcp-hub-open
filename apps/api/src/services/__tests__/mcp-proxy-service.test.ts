import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpProxyService } from "../mcp-proxy-service.js";
import type { SessionContext } from "../mcp-proxy-service.js";
import type { ManagedServer } from "../../types/server.js";
import type { ProcessService } from "../process-service.js";

function makeServer(overrides: Partial<ManagedServer> = {}): ManagedServer {
  return {
    id: "srv-1",
    name: "Test Server",
    runtimeKind: "node",
    transportType: "stdio",
    env: [],
    status: "running",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeProcesses(overrides: Partial<ProcessService> = {}): ProcessService {
  return {
    sendJsonRpc: vi.fn().mockResolvedValue({ result: "ok" }),
    ...overrides
  } as unknown as ProcessService;
}

describe("McpProxyService", () => {
  let processes: ProcessService;
  let service: McpProxyService;

  beforeEach(() => {
    processes = makeProcesses();
    service = new McpProxyService(processes);
  });

  describe("proxyWithSession — streamable-http", () => {
    it("happy path: forwards payload, returns parsed JSON, creates session", async () => {
      const server = makeServer({ transportType: "streamable-http", remoteUrl: "https://mcp.example.com/mcp" });
      const responseBody = { result: "hello" };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(responseBody))
      });
      vi.stubGlobal("fetch", fetchMock);

      const ctx: SessionContext = { sessionId: "sess-abc", callerRole: "operator", callerEmail: "user@example.com" };
      const payload = { jsonrpc: "2.0", id: "1", method: "ping" };
      const result = await service.proxyWithSession(server, payload, ctx);

      expect(result).toEqual(responseBody);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(url).toBe("https://mcp.example.com/mcp");
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(init.headers["X-MCP-Session-Id"]).toBe("sess-abc");
      expect(init.headers["X-MCP-Caller-Role"]).toBe("operator");
      expect(init.headers["X-MCP-Caller-Email"]).toBe("user@example.com");

      const session = service.getSession("sess-abc");
      expect(session).toBeDefined();
      expect(session!.serverId).toBe("srv-1");
      expect(session!.requestCount).toBe(1);

      vi.unstubAllGlobals();
    });

    it("does not set caller headers when callerRole/callerEmail are absent", async () => {
      const server = makeServer({ transportType: "streamable-http", remoteUrl: "https://mcp.example.com/mcp" });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("{}")
      });
      vi.stubGlobal("fetch", fetchMock);

      await service.proxyWithSession(server, {}, { sessionId: "sess-no-caller" });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(init.headers["X-MCP-Caller-Role"]).toBeUndefined();
      expect(init.headers["X-MCP-Caller-Email"]).toBeUndefined();

      vi.unstubAllGlobals();
    });

    it("returns { raw: text } when response body is not valid JSON", async () => {
      const server = makeServer({ transportType: "streamable-http", remoteUrl: "https://mcp.example.com/mcp" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("not-json")
      }));

      const result = await service.proxyWithSession(server, {}, { sessionId: "sess-raw" });
      expect(result).toEqual({ raw: "not-json" });

      vi.unstubAllGlobals();
    });

    it("throws when remoteUrl is not configured", async () => {
      const server = makeServer({ transportType: "streamable-http", remoteUrl: undefined });
      await expect(service.proxyWithSession(server, {}, { sessionId: "sess-err" })).rejects.toThrow("No remoteUrl configured");
    });

    it("throws when upstream responds with a non-ok status", async () => {
      const server = makeServer({ transportType: "streamable-http", remoteUrl: "https://mcp.example.com/mcp" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve("Service Unavailable")
      }));

      await expect(service.proxyWithSession(server, {}, { sessionId: "sess-fail" })).rejects.toThrow("Service Unavailable");

      vi.unstubAllGlobals();
    });

    it("throws with HTTP status when upstream error body is empty", async () => {
      const server = makeServer({ transportType: "streamable-http", remoteUrl: "https://mcp.example.com/mcp" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("")
      }));

      await expect(service.proxyWithSession(server, {}, { sessionId: "sess-empty-err" })).rejects.toThrow("HTTP 500");

      vi.unstubAllGlobals();
    });
  });

  describe("proxyWithSession — stdio", () => {
    it("delegates to ProcessService.sendJsonRpc with the same payload", async () => {
      const server = makeServer({ transportType: "stdio" });
      const payload = { jsonrpc: "2.0", id: "2", method: "tools/list" };
      const ctx: SessionContext = { sessionId: "sess-stdio", callerRole: "admin" };

      const result = await service.proxyWithSession(server, payload, ctx);

      expect(processes.sendJsonRpc).toHaveBeenCalledWith(server, payload);
      expect(result).toEqual({ result: "ok" });
    });
  });

  describe("session lifecycle", () => {
    it("getSession returns undefined for unknown session", () => {
      expect(service.getSession("unknown")).toBeUndefined();
    });

    it("listSessions returns empty array initially", () => {
      expect(service.listSessions()).toEqual([]);
    });

    it("session is created on first proxyWithSession call", async () => {
      const server = makeServer({ transportType: "stdio" });
      await service.proxyWithSession(server, {}, { sessionId: "sess-1" });

      const session = service.getSession("sess-1");
      expect(session).toBeDefined();
      expect(session!.sessionId).toBe("sess-1");
      expect(session!.serverId).toBe("srv-1");
      expect(session!.requestCount).toBe(1);
    });

    it("requestCount increments and lastUsedAt updates on repeated calls", async () => {
      const server = makeServer({ transportType: "stdio" });
      await service.proxyWithSession(server, {}, { sessionId: "sess-repeat" });
      const first = service.getSession("sess-repeat")!;
      const firstUsed = first.lastUsedAt;

      await new Promise((r) => setTimeout(r, 5));
      await service.proxyWithSession(server, {}, { sessionId: "sess-repeat" });
      const second = service.getSession("sess-repeat")!;

      expect(second.requestCount).toBe(2);
      expect(second.createdAt).toBe(first.createdAt);
      expect(new Date(second.lastUsedAt).getTime()).toBeGreaterThanOrEqual(new Date(firstUsed).getTime());
    });

    it("listSessions returns all active sessions", async () => {
      const server = makeServer({ transportType: "stdio" });
      await service.proxyWithSession(server, {}, { sessionId: "sess-a" });
      await service.proxyWithSession(server, {}, { sessionId: "sess-b" });

      const sessions = service.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.sessionId).sort()).toEqual(["sess-a", "sess-b"]);
    });

    it("clearSession removes the session and returns true", async () => {
      const server = makeServer({ transportType: "stdio" });
      await service.proxyWithSession(server, {}, { sessionId: "sess-del" });
      expect(service.clearSession("sess-del")).toBe(true);
      expect(service.getSession("sess-del")).toBeUndefined();
    });

    it("clearSession returns false for a non-existent session", () => {
      expect(service.clearSession("does-not-exist")).toBe(false);
    });
  });

  describe("proxy — backward compatibility", () => {
    it("calls proxyWithSession with an auto-generated sessionId", async () => {
      const server = makeServer({ transportType: "stdio" });
      const proxyWithSessionSpy = vi.spyOn(service, "proxyWithSession");

      await service.proxy(server, { method: "ping" });

      expect(proxyWithSessionSpy).toHaveBeenCalledOnce();
      const [, , ctx] = proxyWithSessionSpy.mock.calls[0];
      expect(typeof ctx.sessionId).toBe("string");
      expect(ctx.sessionId.length).toBeGreaterThan(0);
      expect(ctx.callerRole).toBeUndefined();
      expect(ctx.callerEmail).toBeUndefined();
    });

    it("creates a session entry automatically", async () => {
      const server = makeServer({ transportType: "stdio" });
      await service.proxy(server, {});
      expect(service.listSessions()).toHaveLength(1);
    });
  });
});
