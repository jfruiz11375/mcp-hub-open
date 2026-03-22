import fs from "fs-extra";
import path from "node:path";
import { config } from "../config.js";
import type { ManagedServer, RegistryFile } from "../types/server.js";
import { VaultService } from "./vault-service.js";

const vault = new VaultService();

export class RegistryService {
  async ensureStore(): Promise<void> {
    await fs.ensureDir(config.dataDir);
    await fs.ensureDir(config.reposDir);
    await fs.ensureDir(config.logsDir);
    await fs.ensureDir(path.dirname(config.dataFile));

    const exists = await fs.pathExists(config.dataFile);
    if (!exists) {
      const initial: RegistryFile = { servers: [] };
      await fs.writeJson(config.dataFile, initial, { spaces: 2 });
    }
  }

  sanitize(server: ManagedServer): ManagedServer {
    return { ...server, env: vault.sanitizeEnv(server.env) };
  }

  withEncryptedSecrets(server: ManagedServer): ManagedServer {
    return { ...server, env: vault.encryptEnv(server.env) };
  }

  withDecryptedSecrets(server: ManagedServer): ManagedServer {
    return { ...server, env: vault.decryptEnv(server.env) };
  }

  async readAllRaw(): Promise<ManagedServer[]> {
    await this.ensureStore();
    const payload = (await fs.readJson(config.dataFile)) as RegistryFile;
    return payload.servers;
  }

  async readAll(): Promise<ManagedServer[]> {
    const servers = await this.readAllRaw();
    return servers.map((server) => this.sanitize(server));
  }

  async writeAll(servers: ManagedServer[]): Promise<void> {
    await this.ensureStore();
    await fs.writeJson(config.dataFile, { servers }, { spaces: 2 });
  }

  async getById(id: string): Promise<ManagedServer | undefined> {
    const servers = await this.readAllRaw();
    const server = servers.find((item) => item.id === id);
    return server ? this.sanitize(server) : undefined;
  }

  async getByIdRaw(id: string): Promise<ManagedServer | undefined> {
    const servers = await this.readAllRaw();
    return servers.find((server) => server.id === id);
  }

  async getByIdForRuntime(id: string): Promise<ManagedServer | undefined> {
    const server = await this.getByIdRaw(id);
    return server ? this.withDecryptedSecrets(server) : undefined;
  }

  async create(server: ManagedServer): Promise<ManagedServer> {
    const servers = await this.readAllRaw();
    const encrypted = this.withEncryptedSecrets(server);
    servers.push(encrypted);
    await this.writeAll(servers);
    return this.sanitize(encrypted);
  }

  async update(id: string, patch: Partial<ManagedServer>): Promise<ManagedServer> {
    const servers = await this.readAllRaw();
    const index = servers.findIndex((server) => server.id === id);
    if (index < 0) {
      throw new Error(`Server not found: ${id}`);
    }

    const updated: ManagedServer = {
      ...servers[index],
      ...patch,
      env: patch.env ? vault.encryptEnv(patch.env) : servers[index].env,
      updatedAt: new Date().toISOString()
    };

    servers[index] = updated;
    await this.writeAll(servers);
    return this.sanitize(updated);
  }

  async remove(id: string): Promise<void> {
    const servers = await this.readAllRaw();
    await this.writeAll(servers.filter((server) => server.id !== id));
  }
}
