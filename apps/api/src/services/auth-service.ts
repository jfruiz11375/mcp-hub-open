import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import { config } from "../config.js";
import type { UserRecord, UsersFile, UserRole } from "../types/auth.js";

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function signJwt(payload: Record<string, unknown>, secret: string, expiresInSeconds = 60 * 60 * 8): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedBody}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedBody}.${signature}`;
}

function verifyJwt(token: string, secret: string): Record<string, any> {
  const [header, payload, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  if (expected !== signature) throw new Error("Invalid token signature");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (decoded.exp && Date.now() / 1000 > decoded.exp) throw new Error("Token expired");
  return decoded;
}

async function scryptHash(password: string, salt?: string): Promise<string> {
  const usedSalt = salt || crypto.randomBytes(16).toString("hex");
  const key = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, usedSalt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
  return `scrypt:${usedSalt}:${key.toString("hex")}`;
}

async function comparePassword(password: string, hash: string): Promise<boolean> {
  const [scheme, salt, expected] = hash.split(":");
  if (scheme !== "scrypt") return false;
  const actual = await scryptHash(password, salt);
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(`scrypt:${salt}:${expected}`));
}

export class AuthService {
  async ensureStore(): Promise<void> {
    await fs.ensureDir(path.dirname(config.usersFile));
    const exists = await fs.pathExists(config.usersFile);
    if (!exists) {
      const now = new Date().toISOString();
      const admin: UserRecord = {
        id: "admin",
        email: config.adminEmail,
        name: "Admin",
        role: "admin",
        passwordHash: await scryptHash(config.adminPassword),
        createdAt: now,
        updatedAt: now
      };
      await fs.writeJson(config.usersFile, { users: [admin] } satisfies UsersFile, { spaces: 2 });
    }
  }

  async listUsers(): Promise<UserRecord[]> {
    await this.ensureStore();
    const data = (await fs.readJson(config.usersFile)) as UsersFile;
    return data.users;
  }

  async createUser(input: { email: string; name: string; password: string; role: UserRole }): Promise<UserRecord> {
    const users = await this.listUsers();
    if (users.some((user) => user.email.toLowerCase() === input.email.toLowerCase())) {
      throw new Error("User already exists");
    }
    const now = new Date().toISOString();
    const user: UserRecord = {
      id: input.email.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash: await scryptHash(input.password),
      createdAt: now,
      updatedAt: now
    };
    users.push(user);
    await fs.writeJson(config.usersFile, { users }, { spaces: 2 });
    return user;
  }

  sanitizeUser(user: UserRecord) {
    const { passwordHash, ...rest } = user;
    return rest;
  }

  issueToken(user: UserRecord): string {
    return signJwt({ sub: user.id, email: user.email, role: user.role, name: user.name }, config.jwtSecret);
  }

  verifyToken(token: string) {
    return verifyJwt(token, config.jwtSecret);
  }

  async authenticateLocal(email: string, password: string): Promise<UserRecord> {
    const users = await this.listUsers();
    const user = users.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());
    if (!user || user.disabled) throw new Error("Invalid credentials");
    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) throw new Error("Invalid credentials");
    return user;
  }

  async exchangeOidcCode(code: string, state: string) {
    if (!config.oidcIssuer || !config.oidcClientId || !config.oidcClientSecret || !config.oidcRedirectUri) {
      throw new Error("OIDC is not configured");
    }

    const metadataResponse = await fetch(`${config.oidcIssuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
    if (!metadataResponse.ok) throw new Error("Failed to load OIDC metadata");
    const metadata = await metadataResponse.json() as { token_endpoint: string; userinfo_endpoint?: string };

    const tokenResponse = await fetch(metadata.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.oidcRedirectUri,
        client_id: config.oidcClientId,
        client_secret: config.oidcClientSecret
      })
    });

    if (!tokenResponse.ok) throw new Error("Failed to exchange OIDC code");
    const tokenPayload = await tokenResponse.json() as { access_token?: string; id_token?: string };
    let profile: { email?: string; name?: string } = {};

    if (metadata.userinfo_endpoint && tokenPayload.access_token) {
      const userinfoResponse = await fetch(metadata.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokenPayload.access_token}` }
      });
      if (userinfoResponse.ok) {
        profile = await userinfoResponse.json() as { email?: string; name?: string };
      }
    }

    const email = profile.email || `oidc-${state}@example.local`;
    const users = await this.listUsers();
    let user = users.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      user = await this.createUser({
        email,
        name: profile.name || email,
        password: crypto.randomBytes(24).toString("hex"),
        role: "viewer"
      });
    }
    return user;
  }

  getOidcStartUrl(state: string): string {
    if (!config.oidcIssuer || !config.oidcClientId || !config.oidcRedirectUri) {
      throw new Error("OIDC is not configured");
    }

    const issuer = config.oidcIssuer.replace(/\/$/, "");
    const authorizeUrl = `${issuer}/authorize`;
    const query = new URLSearchParams({
      response_type: "code",
      client_id: config.oidcClientId,
      redirect_uri: config.oidcRedirectUri,
      scope: config.oidcScope,
      state
    });
    return `${authorizeUrl}?${query.toString()}`;
  }
}
