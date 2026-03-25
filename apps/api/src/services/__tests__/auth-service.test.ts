import { describe, it, expect, vi, beforeEach, beforeAll, afterEach, afterAll } from "vitest";
import crypto from "node:crypto";

vi.mock("../../config.js", () => ({
  config: {
    usersFile: `/tmp/mcp-auth-test-${process.pid}/users.json`,
    jwtSecret: "test-jwt-secret-for-tests-only",
    adminEmail: "admin@test.com",
    adminPassword: "TestAdmin1!",
    oidcIssuer: undefined as string | undefined,
    oidcClientId: undefined as string | undefined,
    oidcClientSecret: undefined as string | undefined,
    oidcRedirectUri: undefined as string | undefined,
    oidcScope: "openid profile email"
  }
}));

import fs from "fs-extra";
import path from "node:path";
import { AuthService } from "../auth-service.js";

const TEST_DIR = `/tmp/mcp-auth-test-${process.pid}`;

describe("AuthService", () => {
  let service: AuthService;

  beforeEach(async () => {
    await fs.remove(TEST_DIR);
    service = new AuthService();
  });

  afterAll(async () => {
    await fs.remove(TEST_DIR);
  });

  describe("ensureStore", () => {
    it("creates the users file with a default admin user", async () => {
      await service.ensureStore();
      const data = await fs.readJson(path.join(TEST_DIR, "users.json"));
      expect(data.users).toHaveLength(1);
      expect(data.users[0].email).toBe("admin@test.com");
      expect(data.users[0].role).toBe("admin");
    });

    it("does not overwrite an existing users file", async () => {
      await service.ensureStore();
      await service.createUser({ email: "extra@test.com", name: "Extra", password: "Pass1!", role: "viewer" });
      await service.ensureStore();
      const data = await fs.readJson(path.join(TEST_DIR, "users.json"));
      expect(data.users).toHaveLength(2);
    });
  });

  describe("listUsers", () => {
    it("returns the seeded admin user after ensureStore", async () => {
      await service.ensureStore();
      const users = await service.listUsers();
      expect(users).toHaveLength(1);
      expect(users[0].email).toBe("admin@test.com");
    });
  });

  describe("createUser", () => {
    it("creates a new user and returns a UserRecord", async () => {
      await service.ensureStore();
      const user = await service.createUser({
        email: "new@test.com",
        name: "New User",
        password: "Password1!",
        role: "viewer"
      });
      expect(user.email).toBe("new@test.com");
      expect(user.name).toBe("New User");
      expect(user.role).toBe("viewer");
    });

    it("throws 'User already exists' when email is already taken", async () => {
      await service.ensureStore();
      await expect(
        service.createUser({ email: "admin@test.com", name: "Dup", password: "Password1!", role: "viewer" })
      ).rejects.toThrow("User already exists");
    });

    it("throws 'User already exists' for case-insensitive duplicate", async () => {
      await service.ensureStore();
      await expect(
        service.createUser({ email: "ADMIN@TEST.COM", name: "Dup", password: "Password1!", role: "viewer" })
      ).rejects.toThrow("User already exists");
    });
  });

  describe("sanitizeUser", () => {
    it("removes passwordHash from the returned object", async () => {
      await service.ensureStore();
      const [user] = await service.listUsers();
      const sanitized = service.sanitizeUser(user);
      expect(sanitized).not.toHaveProperty("passwordHash");
      expect(sanitized.email).toBe(user.email);
    });
  });

  describe("issueToken", () => {
    it("returns a JWT string with 3 dot-separated parts", async () => {
      await service.ensureStore();
      const [user] = await service.listUsers();
      const token = service.issueToken(user);
      expect(token.split(".")).toHaveLength(3);
    });
  });

  describe("verifyToken", () => {
    it("correctly decodes a token issued by issueToken", async () => {
      await service.ensureStore();
      const [user] = await service.listUsers();
      const token = service.issueToken(user);
      const decoded = service.verifyToken(token);
      expect(decoded.sub).toBe(user.id);
      expect(decoded.email).toBe(user.email);
    });

    it("throws on an invalid token", () => {
      expect(() => service.verifyToken("not.a.valid-token")).toThrow();
    });
  });

  describe("authenticateLocal", () => {
    it("returns the user on valid credentials", async () => {
      await service.ensureStore();
      const user = await service.authenticateLocal("admin@test.com", "TestAdmin1!");
      expect(user.email).toBe("admin@test.com");
    });

    it("throws 'Invalid credentials' on wrong password", async () => {
      await service.ensureStore();
      await expect(service.authenticateLocal("admin@test.com", "wrongpassword")).rejects.toThrow(
        "Invalid credentials"
      );
    });
  });

  describe("exchangeOidcCode", () => {
    const TEST_ISSUER = "https://auth.example.com";
    const TEST_CLIENT_ID = "my-client-id";
    const TEST_JWKS_URI = "https://auth.example.com/.well-known/jwks.json";
    const TEST_KID = "test-key-1";

    let rsaPrivateKey: crypto.KeyObject;
    let rsaPublicJwk: crypto.JsonWebKey;

    function makeIdToken(claims: Record<string, unknown>, signingKey?: crypto.KeyObject): string {
      const key = signingKey ?? rsaPrivateKey;
      const headerB64 = Buffer.from(JSON.stringify({ alg: "RS256", kid: TEST_KID, typ: "JWT" })).toString("base64url");
      const payloadB64 = Buffer.from(JSON.stringify(claims)).toString("base64url");
      const signer = crypto.createSign("RSA-SHA256");
      signer.update(`${headerB64}.${payloadB64}`);
      const sig = signer.sign(key).toString("base64url");
      return `${headerB64}.${payloadB64}.${sig}`;
    }

    function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      const now = Math.floor(Date.now() / 1000);
      return {
        iss: TEST_ISSUER,
        aud: TEST_CLIENT_ID,
        sub: "user123",
        email: "user@example.com",
        name: "Test User",
        iat: now - 5,
        exp: now + 3600,
        ...overrides
      };
    }

    function buildFetchMock(idToken: string, jwksUri = TEST_JWKS_URI) {
      // Each test that reaches signature validation uses a unique jwksUri to bypass
      // the module-level JWKS cache so the mock fetch is actually invoked.
      return vi.fn().mockImplementation((url: string, options?: { method?: string }) => {
        if ((url as string).includes("openid-configuration")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              token_endpoint: "https://auth.example.com/token",
              jwks_uri: jwksUri
            })
          });
        }
        if (options?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ access_token: "test-access-token", id_token: idToken })
          });
        }
        if ((url as string) === jwksUri) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ keys: [{ ...rsaPublicJwk, kid: TEST_KID }] })
          });
        }
        return Promise.reject(new Error(`Unexpected fetch to: ${url}`));
      });
    }

    beforeAll(() => {
      const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      rsaPrivateKey = privateKey;
      rsaPublicJwk = publicKey.export({ format: "jwk" });
    });

    beforeEach(async () => {
      const { config } = await import("../../config.js");
      config.oidcIssuer = TEST_ISSUER;
      config.oidcClientId = TEST_CLIENT_ID;
      config.oidcClientSecret = "test-secret";
      config.oidcRedirectUri = "https://app.example.com/callback";
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns the user when the id_token is valid", async () => {
      await service.ensureStore();
      const idToken = makeIdToken(validClaims());
      vi.stubGlobal("fetch", buildFetchMock(idToken));
      const user = await service.exchangeOidcCode("auth-code", "state123");
      expect(user.email).toBe("user@example.com");
      expect(user.role).toBe("viewer");
    });

    it("throws when id_token is missing from the token response", async () => {
      await service.ensureStore();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string, options?: { method?: string }) => {
          if ((url as string).includes("openid-configuration")) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                token_endpoint: "https://auth.example.com/token",
                jwks_uri: TEST_JWKS_URI
              })
            });
          }
          if (options?.method === "POST") {
            return Promise.resolve({
              ok: true,
              json: async () => ({ access_token: "tok" })
            });
          }
          return Promise.reject(new Error("unexpected"));
        })
      );
      await expect(service.exchangeOidcCode("auth-code", "state123")).rejects.toThrow("id_token");
    });

    it("throws when the id_token issuer does not match", async () => {
      await service.ensureStore();
      const idToken = makeIdToken(validClaims({ iss: "https://evil.example.com" }));
      vi.stubGlobal("fetch", buildFetchMock(idToken, "https://auth.example.com/jwks-wrong-iss.json"));
      await expect(service.exchangeOidcCode("auth-code", "state123")).rejects.toThrow("issuer mismatch");
    });

    it("throws when the id_token is expired", async () => {
      await service.ensureStore();
      const now = Math.floor(Date.now() / 1000);
      const idToken = makeIdToken(validClaims({ exp: now - 60, iat: now - 120 }));
      vi.stubGlobal("fetch", buildFetchMock(idToken, "https://auth.example.com/jwks-expired.json"));
      await expect(service.exchangeOidcCode("auth-code", "state123")).rejects.toThrow("expired");
    });

    it("throws when the id_token signature is invalid", async () => {
      await service.ensureStore();
      const idToken = makeIdToken(validClaims());
      // Tamper with the payload portion to invalidate the signature
      const parts = idToken.split(".");
      const tamperedPayload = Buffer.from(
        JSON.stringify({
          ...JSON.parse(Buffer.from(parts[1], "base64url").toString()),
          email: "attacker@evil.com"
        })
      ).toString("base64url");
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
      vi.stubGlobal("fetch", buildFetchMock(tamperedToken, "https://auth.example.com/jwks-badsig.json"));
      await expect(service.exchangeOidcCode("auth-code", "state123")).rejects.toThrow(
        "signature verification failed"
      );
    });
  });
});
