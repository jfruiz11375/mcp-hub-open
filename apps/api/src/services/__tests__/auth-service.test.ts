import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    usersFile: `/tmp/mcp-auth-test-${process.pid}/users.json`,
    jwtSecret: "test-jwt-secret-for-tests-only",
    adminEmail: "admin@test.com",
    adminPassword: "TestAdmin1!"
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
});
