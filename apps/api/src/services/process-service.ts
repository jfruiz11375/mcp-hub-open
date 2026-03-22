import fs from "fs-extra";
import path from "node:path";
import { execa, type ExecaChildProcess } from "execa";
import { config } from "../config.js";
import type { ManagedServer } from "../types/server.js";

const processes = new Map<string, ExecaChildProcess>();
const stdoutBuffers = new Map<string, string>();
const pendingRequests = new Map<string, Map<string | number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>>();

function splitCommand(command: string): { file: string; args: string[] } {
  const parts = command.match(/(?:[^\s\"]+|\"[^\"]*\")+/g) || [];
  const cleaned = parts.map((part) => part.replace(/^\"|\"$/g, ""));
  const [file, ...args] = cleaned;
  if (!file) {
    throw new Error("Invalid command");
  }
  return { file, args };
}

function isCommandAllowed(command?: string): boolean {
  if (!command) return false;
  if (config.enableUnsafeCommands) return true;
  return /^(npm|pnpm|yarn|node|python|python3|uv|docker|bash|sh)\b/.test(command.trim());
}

function createDockerArgs(server: ManagedServer, command: string, cwd: string): string[] {
  const image = server.isolation?.dockerImage || "node:20-alpine";
  const args = ["run", "--rm", "-v", `${cwd}:/workspace`, "-w", "/workspace"];
  if (server.isolation?.dockerNetwork) args.push("--network", server.isolation.dockerNetwork);
  for (const item of server.env) args.push("-e", `${item.key}=${item.value}`);
  args.push(image, "sh", "-lc", command);
  return args;
}

export class ProcessService {
  isRunning(id: string): boolean {
    return processes.has(id);
  }

  private attachStdoutParsing(serverId: string, child: ExecaChildProcess) {
    stdoutBuffers.set(serverId, "");
    pendingRequests.set(serverId, new Map());

    child.stdout?.on("data", (chunk) => {
      const current = `${stdoutBuffers.get(serverId) || ""}${chunk.toString()}`;
      const lines = current.split(/\r?\n/);
      stdoutBuffers.set(serverId, lines.pop() || "");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          const payload = JSON.parse(trimmed) as { id?: string | number; error?: unknown; result?: unknown };
          if (payload.id === undefined) continue;
          const pending = pendingRequests.get(serverId)?.get(payload.id);
          if (!pending) continue;
          clearTimeout(pending.timeout);
          pendingRequests.get(serverId)?.delete(payload.id);
          if (payload.error) pending.reject(new Error(JSON.stringify(payload.error)));
          else pending.resolve(payload);
        } catch {
          // Ignore non-JSON lines
        }
      }
    });
  }

  async start(server: ManagedServer): Promise<number> {
    if (!server.startCommand) {
      throw new Error("No start command configured");
    }

    if (!isCommandAllowed(server.startCommand)) {
      throw new Error("Start command blocked. Set ENABLE_UNSAFE_COMMANDS=true to override in a trusted environment.");
    }

    const cwd = server.workingDirectory || server.installedPath;
    if (!cwd) {
      throw new Error("No working directory available");
    }

    await fs.ensureDir(config.logsDir);
    const logPath = path.join(config.logsDir, `${server.id}.log`);
    const env = Object.fromEntries(server.env.map((item) => [item.key, item.value]));

    const child = server.isolation?.mode === "docker" || server.runtimeKind === "docker"
      ? execa("docker", createDockerArgs(server, server.startCommand, cwd), { cwd, env, all: true, shell: false })
      : (() => {
          const { file, args } = splitCommand(server.startCommand!);
          return execa(file, args, { cwd, env, all: true, shell: false });
        })();

    child.all?.on("data", async (chunk) => {
      await fs.appendFile(logPath, chunk.toString());
    });

    this.attachStdoutParsing(server.id, child);

    child.on("exit", async () => {
      processes.delete(server.id);
      stdoutBuffers.delete(server.id);
      const pending = pendingRequests.get(server.id);
      if (pending) {
        for (const item of pending.values()) {
          clearTimeout(item.timeout);
          item.reject(new Error("Server process exited"));
        }
      }
      pendingRequests.delete(server.id);
    });

    processes.set(server.id, child);
    return child.pid ?? 0;
  }

  async stop(id: string): Promise<void> {
    const child = processes.get(id);
    if (!child) return;
    child.kill("SIGTERM", { forceKillAfterDelay: 5000 });
    processes.delete(id);
  }

  async runInstallOrBuild(server: ManagedServer, command?: string): Promise<void> {
    if (!command) return;
    if (!isCommandAllowed(command)) {
      throw new Error("Command blocked. Set ENABLE_UNSAFE_COMMANDS=true to override in a trusted environment.");
    }

    const cwd = server.workingDirectory || server.installedPath;
    if (!cwd) {
      throw new Error("No working directory available");
    }

    await fs.ensureDir(config.logsDir);
    const logPath = path.join(config.logsDir, `${server.id}.log`);
    const env = Object.fromEntries(server.env.map((item) => [item.key, item.value]));

    const task = server.isolation?.mode === "docker" || server.runtimeKind === "docker"
      ? execa("docker", createDockerArgs(server, command, cwd), { cwd, env, all: true, shell: false })
      : (() => {
          const { file, args } = splitCommand(command);
          return execa(file, args, { cwd, env, all: true, shell: false });
        })();

    task.all?.on("data", async (chunk) => {
      await fs.appendFile(logPath, chunk.toString());
    });
    await task;
  }

  async sendJsonRpc(server: ManagedServer, payload: any): Promise<any> {
    const child = processes.get(server.id);
    if (!child || !child.stdin) throw new Error("Server is not running");
    const id = payload?.id;
    if (id === undefined || id === null) throw new Error("JSON-RPC payload must include an id");

    const pending = pendingRequests.get(server.id) || new Map();
    pendingRequests.set(server.id, pending);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("JSON-RPC request timed out"));
      }, 30000);

      pending.set(id, { resolve, reject, timeout });
      child.stdin!.write(`${JSON.stringify(payload)}\n`);
    });
  }

  async readLog(id: string): Promise<string> {
    const logPath = path.join(config.logsDir, `${id}.log`);
    const exists = await fs.pathExists(logPath);
    if (!exists) return "";
    return fs.readFile(logPath, "utf8");
  }
}
