import { describe, it, expect, vi, beforeEach } from "vitest";
import { VaultService } from "../vault-service.js";

// Use a fixed master key so tests are deterministic and independent of .env files
vi.mock("../../config.js", () => ({
  config: {
    vaultMasterKey: "test-master-key-for-unit-tests"
  }
}));

const ENC_PREFIX = "enc:v1";

describe("VaultService", () => {
  let vault: VaultService;

  beforeEach(() => {
    vault = new VaultService();
  });

  describe("encrypt", () => {
    it("returns a string with the enc:v1 prefix", () => {
      const result = vault.encrypt("my-secret");
      expect(result.startsWith(`${ENC_PREFIX}:`)).toBe(true);
    });

    it("produces five colon-separated parts (enc:v1:iv:tag:payload)", () => {
      const result = vault.encrypt("hello");
      const parts = result.split(":");
      expect(parts).toHaveLength(5);
    });

    it("produces different ciphertext on each call (random IV)", () => {
      const a = vault.encrypt("same-value");
      const b = vault.encrypt("same-value");
      expect(a).not.toBe(b);
    });
  });

  describe("decrypt", () => {
    it("recovers the original plaintext", () => {
      const original = "super-secret-value";
      const encrypted = vault.encrypt(original);
      expect(vault.decrypt(encrypted)).toBe(original);
    });

    it("returns the input unchanged when it does not start with enc:v1", () => {
      const plain = "not-encrypted";
      expect(vault.decrypt(plain)).toBe(plain);
    });

    it("handles empty string round-trip", () => {
      const encrypted = vault.encrypt("");
      expect(vault.decrypt(encrypted)).toBe("");
    });

    it("handles unicode characters round-trip", () => {
      const original = "日本語テスト 🔐";
      expect(vault.decrypt(vault.encrypt(original))).toBe(original);
    });
  });

  describe("encryptEnv", () => {
    it("encrypts only fields marked as secret with a truthy value", () => {
      const env = [
        { key: "API_KEY", value: "abc123", secret: true },
        { key: "HOST", value: "localhost", secret: false }
      ];
      const result = vault.encryptEnv(env);
      expect(result[0].value.startsWith(`${ENC_PREFIX}:`)).toBe(true);
      expect(result[1].value).toBe("localhost");
    });

    it("leaves secret fields with empty value as-is", () => {
      const env = [{ key: "TOKEN", value: "", secret: true }];
      const result = vault.encryptEnv(env);
      expect(result[0].value).toBe("");
    });
  });

  describe("decryptEnv", () => {
    it("decrypts secret fields and leaves non-secret fields unchanged", () => {
      const original = "my-token";
      const encrypted = vault.encrypt(original);
      const env = [
        { key: "TOKEN", value: encrypted, secret: true },
        { key: "HOST", value: "localhost", secret: false }
      ];
      const result = vault.decryptEnv(env);
      expect(result[0].value).toBe(original);
      expect(result[1].value).toBe("localhost");
    });

    it("is the inverse of encryptEnv", () => {
      const env = [
        { key: "PASSWORD", value: "p@ssw0rd", secret: true },
        { key: "PORT", value: "8080", secret: false }
      ];
      const roundTripped = vault.decryptEnv(vault.encryptEnv(env));
      expect(roundTripped).toEqual(env);
    });
  });

  describe("sanitizeEnv", () => {
    it("masks non-empty secret values with ********", () => {
      const env = [{ key: "API_KEY", value: "abc123", secret: true }];
      const result = vault.sanitizeEnv(env);
      expect(result[0].value).toBe("********");
    });

    it("leaves empty secret values as empty string", () => {
      const env = [{ key: "API_KEY", value: "", secret: true }];
      const result = vault.sanitizeEnv(env);
      expect(result[0].value).toBe("");
    });

    it("leaves non-secret values unchanged", () => {
      const env = [{ key: "HOST", value: "localhost", secret: false }];
      const result = vault.sanitizeEnv(env);
      expect(result[0].value).toBe("localhost");
    });
  });
});
