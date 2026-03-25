import crypto from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { RegistryService } from "../services/registry-service.js";
import { GitService } from "../services/git-service.js";
import { ProcessService } from "../services/process-service.js";
import { AuthService } from "../services/auth-service.js";
import { NodeService } from "../services/node-service.js";
import { McpProxyService } from "../services/mcp-proxy-service.js";
import type { SessionContext } from "../services/mcp-proxy-service.js";
import { SignatureService } from "../services/signature-service.js";
import { config } from "../config.js";
import type { ManagedServer } from "../types/server.js";
import type { UserRole } from "../types/auth.js";

const envSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  secret: z.boolean().optional().default(false)
});

const createServerSchema = z.object({
  id: z.string().min(2),
  name: z.string().min(2),
  description: z.string().optional(),
  repoUrl: z.string().url().optional(),
  branch: z.string().default("main"),
  subdirectory: z.string().optional(),
  runtimeKind: z.enum(["node", "python", "docker", "remote"]),
  transportType: z.enum(["stdio", "streamable-http"]),
  installCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  workingDirectory: z.string().optional(),
  remoteUrl: z.string().url().optional(),
  targetNodeId: z.string().optional(),
  isolation: z.object({
    mode: z.enum(["process", "docker"]).default("process"),
    dockerImage: z.string().optional(),
    dockerNetwork: z.string().optional()
  }).optional(),
  packageVerification: z.object({
    mode: z.enum(["none", "checksum", "signature"]).default("none"),
    targetPath: z.string().optional(),
    expectedSha256: z.string().optional(),
    manifestPath: z.string().optional(),
    signaturePath: z.string().optional(),
    publicKeyPem: z.string().optional()
  }).optional(),
  env: z.array(envSchema).default([])
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(["admin", "operator", "viewer"])
});

const registerNodeSchema = z.object({
  id: z.string().min(2),
  name: z.string().min(1),
  baseUrl: z.string().url().optional(),
  capabilities: z.array(z.string()).default([]),
  labels: z.record(z.string()).default({})
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

async function requireRole(request: FastifyRequest, reply: FastifyReply, roles: UserRole[]) {
  if (!config.requireAuth) return;
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing bearer token" });
  }

  try {
    const auth = new AuthService();
    const payload = auth.verifyToken(authHeader.slice("Bearer ".length));
    (request as any).user = payload;
    if (!roles.includes(payload.role)) {
      return reply.code(403).send({ error: "Insufficient role" });
    }
  } catch (error) {
    return reply.code(401).send({ error: error instanceof Error ? error.message : "Unauthorized" });
  }
}

function jsonRpcId() {
  return crypto.randomUUID();
}

export async function registerServerRoutes(app: FastifyInstance) {
  const registry = new RegistryService();
  const git = new GitService();
  const processes = new ProcessService();
  const auth = new AuthService();
  const nodes = new NodeService();
  const proxy = new McpProxyService(processes);
  const signatures = new SignatureService();

  await auth.ensureStore();
  await nodes.ensureStore();

  app.get("/api/health", async () => ({ ok: true, time: new Date().toISOString(), authRequired: config.requireAuth }));
  app.get("/api/auth/providers", async () => ({ local: true, oidc: Boolean(config.oidcIssuer && config.oidcClientId) }));
  app.post("/api/auth/login", async (request, reply) => {
    const payload = loginSchema.parse(request.body);
    try {
      const user = await auth.authenticateLocal(payload.email, payload.password);
      return { token: auth.issueToken(user), user: auth.sanitizeUser(user) };
    } catch (error) {
      return reply.code(401).send({ error: error instanceof Error ? error.message : "Invalid credentials" });
    }
  });
  app.get("/api/auth/oidc/start", async () => {
    const state = crypto.randomUUID();
    return { url: auth.getOidcStartUrl(state), state };
  });
  app.get("/api/auth/oidc/callback", async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };
    if (!code || !state) return reply.code(400).send({ error: "Missing code or state" });
    try {
      const user = await auth.exchangeOidcCode(code, state);
      return { token: auth.issueToken(user), user: auth.sanitizeUser(user) };
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : "OIDC callback failed" });
    }
  });

  app.get("/api/users", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin"]);
    if (denied) return denied;
    return (await auth.listUsers()).map((user) => auth.sanitizeUser(user));
  });
  app.post("/api/users", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin"]);
    if (denied) return denied;
    const payload = createUserSchema.parse(request.body);
    const user = await auth.createUser(payload);
    return reply.code(201).send(auth.sanitizeUser(user));
  });

  app.get("/api/nodes", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin", "operator", "viewer"]);
    if (denied) return denied;
    return nodes.listNodes();
  });
  app.post("/api/nodes/register", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin"]);
    if (denied) return denied;
    const payload = registerNodeSchema.parse(request.body);
    return reply.code(201).send(await nodes.upsertNode(payload));
  });
  app.post("/api/nodes/:id/heartbeat", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin", "operator"]);
    if (denied) return denied;
    try {
      return await nodes.heartbeat((request.params as { id: string }).id);
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "Node not found" });
    }
  });

  app.get("/api/servers", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin", "operator", "viewer"]);
    if (denied) return denied;
    return registry.readAll();
  });

  app.get("/api/servers/:id", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin", "operator", "viewer"]);
    if (denied) return denied;
    const server = await registry.getById((request.params as { id: string }).id);
    if (!server) {
      return reply.code(404).send({ error: "Server not found" });
    }
    return server;
  });

  app.post("/api/servers", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin", "operator"]);
    if (denied) return denied;
    const payload = createServerSchema.parse(request.body);
    const existing = await registry.getById(payload.id);
    if (existing) {
      return reply.code(409).send({ error: "Server id already exists" });
    }

    const now = new Date().toISOString();
    const server: ManagedServer = {
      ...payload,
      targetNodeId: payload.targetNodeId || config.localNodeId,
      isolation: payload.isolation || { mode: payload.runtimeKind === "docker" ? "docker" : "process", dockerImage: payload.runtimeKind === "docker" ? "node:20-alpine" : undefined },
      packageVerification: payload.packageVerification || { mode: "none" },
      status: payload.runtimeKind === "remote" ? "stopped" : "draft",
      createdAt: now,
      updatedAt: now
    };

    const created = await registry.create(server);
    return reply.code(201).send(created);
  });

  app.put("/api/servers/:id", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin", "operator"]);
    if (denied) return denied;
    const id = (request.params as { id: string }).id;
    const patch = createServerSchema.partial().parse(request.body);
    try {
      const updated = await registry.update(id, patch);
      return updated;
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : "Not found" });
    }
  });

  app.delete("/api/servers/:id", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin"]);
    if (denied) return denied;
    const id = (request.params as { id: string }).id;
    await processes.stop(id);
    await registry.remove(id);
    return reply.code(204).send();
  });

  app.post("/api/servers/:id/install", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin", "operator"]);
    if (denied) return denied;
    const id = (request.params as { id: string }).id;
    const server = await registry.getByIdForRuntime(id);
    if (!server) {
      return reply.code(404).send({ error: "Server not found" });
    }
    if (server.targetNodeId && server.targetNodeId !== config.localNodeId) {
      return reply.code(409).send({ error: `Server is assigned to node ${server.targetNodeId}` });
    }
    if (!server.repoUrl) {
      return reply.code(400).send({ error: "Server does not have a repoUrl" });
    }

    try {
      const result = await git.cloneOrPull(id, server.repoUrl, server.branch || "main");
      const workingDirectory = server.subdirectory
        ? `${result.targetDir}/${server.subdirectory.replace(/^\/+/, "")}`
        : result.targetDir;

      await registry.update(id, {
        installedPath: result.targetDir,
        workingDirectory,
        lastInstalledAt: new Date().toISOString(),
        status: "stopped",
        lastError: undefined
      });

      const installedServer = await registry.getByIdForRuntime(id);
      if (!installedServer) {
        return reply.code(500).send({ error: "Server disappeared after install" });
      }

      const verification = await signatures.verify(installedServer);
      if (!verification.ok) {
        await registry.update(id, { status: "error", lastError: verification.reason });
        return reply.code(400).send({ error: verification.reason });
      }

      await processes.runInstallOrBuild(installedServer, installedServer.installCommand);
      await processes.runInstallOrBuild(installedServer, installedServer.buildCommand);

      const updated = await registry.getById(id);
      return { ok: true, result, server: updated };
    } catch (error) {
      await registry.update(id, {
        status: "error",
        lastError: error instanceof Error ? error.message : "Install failed"
      });
      return reply.code(500).send({ error: error instanceof Error ? error.message : "Install failed" });
    }
  });

  app.post("/api/servers/:id/start", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin", "operator"]);
    if (denied) return denied;
    const id = (request.params as { id: string }).id;
    const server = await registry.getByIdForRuntime(id);
    if (!server) {
      return reply.code(404).send({ error: "Server not found" });
    }
    if (server.targetNodeId && server.targetNodeId !== config.localNodeId) {
      return reply.code(409).send({ error: `Server is assigned to node ${server.targetNodeId}` });
    }

    try {
      await registry.update(id, { status: "starting", lastError: undefined });
      const pid = await processes.start(server);
      const updated = await registry.update(id, {
        status: "running",
        pid,
        lastStartedAt: new Date().toISOString(),
        lastError: undefined
      });
      return { ok: true, server: updated };
    } catch (error) {
      const updated = await registry.update(id, {
        status: "error",
        lastError: error instanceof Error ? error.message : "Start failed"
      });
      return reply.code(500).send({ error: updated.lastError });
    }
  });

  app.post("/api/servers/:id/stop", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin", "operator"]);
    if (denied) return denied;
    const id = (request.params as { id: string }).id;
    const server = await registry.getById(id);
    if (!server) {
      return reply.code(404).send({ error: "Server not found" });
    }

    await processes.stop(id);
    const updated = await registry.update(id, {
      status: "stopped",
      pid: undefined,
      lastStoppedAt: new Date().toISOString()
    });
    return { ok: true, server: updated };
  });

  app.get("/api/servers/:id/logs", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin", "operator", "viewer"]);
    if (denied) return denied;
    const id = (request.params as { id: string }).id;
    const server = await registry.getById(id);
    if (!server) {
      return reply.code(404).send({ error: "Server not found" });
    }
    const log = await processes.readLog(id);
    return { id, log };
  });

  app.post("/api/servers/:id/mcp", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin", "operator", "viewer"]);
    if (denied) return denied;
    const id = (request.params as { id: string }).id;
    const server = await registry.getByIdForRuntime(id);
    if (!server) return reply.code(404).send({ error: "Server not found" });

    try {
      const user = (request as any).user as { role?: string; email?: string } | undefined;
      const sessionId = (request.headers["x-mcp-session-id"] as string | undefined) || crypto.randomUUID();
      const sessionContext: SessionContext = {
        sessionId,
        callerRole: user?.role,
        callerEmail: user?.email
      };
      const body = request.body && typeof request.body === "object" ? request.body : {};
      const payload = { jsonrpc: "2.0", id: jsonRpcId(), ...(body as object) };
      const result = await proxy.proxyWithSession(server, payload, sessionContext);
      reply.header("x-mcp-session-id", sessionId);
      return result;
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : "MCP proxy failed" });
    }
  });

  app.get("/api/sessions", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin", "operator"]);
    if (denied) return denied;
    return proxy.listSessions();
  });

  app.delete("/api/sessions/:sessionId", async (request, reply) => {
    const denied = await requireRole(request, reply, ["admin"]);
    if (denied) return denied;
    const { sessionId } = request.params as { sessionId: string };
    const deleted = proxy.clearSession(sessionId);
    if (!deleted) return reply.code(404).send({ error: "Session not found" });
    return { ok: true, sessionId };
  });
}
