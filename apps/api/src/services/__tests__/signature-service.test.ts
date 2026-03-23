import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { SignatureService } from "../signature-service.js";
import type { ManagedServer } from "../../types/server.js";

vi.mock("fs-extra");
import fs from "fs-extra";

// Minimal ManagedServer fixture
function makeServer(overrides: Partial<ManagedServer> = {}): ManagedServer {
  return {
    id: "test-id",
    name: "test-server",
    runtimeKind: "node",
    transportType: "stdio",
    env: [],
    status: "stopped",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("SignatureService", () => {
  let service: SignatureService;

  beforeEach(() => {
    service = new SignatureService();
    vi.resetAllMocks();
  });

  describe("verify — mode: none / missing verification", () => {
    it("returns { ok: true } when packageVerification is undefined", async () => {
      const server = makeServer({ packageVerification: undefined });
      const result = await service.verify(server);
      expect(result).toEqual({ ok: true });
    });

    it('returns { ok: true } when packageVerification.mode === "none"', async () => {
      const server = makeServer({ packageVerification: { mode: "none" } });
      const result = await service.verify(server);
      expect(result).toEqual({ ok: true });
    });
  });

  describe("verify — missing base directory", () => {
    it("returns { ok: false } when both workingDirectory and installedPath are absent", async () => {
      const server = makeServer({
        packageVerification: { mode: "checksum", targetPath: "file.txt", expectedSha256: "abc" },
        workingDirectory: undefined,
        installedPath: undefined
      });
      const result = await service.verify(server);
      expect(result).toEqual({ ok: false, reason: "No installed path available for verification" });
    });
  });

  describe("verify — mode: checksum", () => {
    it("returns { ok: false } when targetPath or expectedSha256 is missing", async () => {
      const server = makeServer({
        packageVerification: { mode: "checksum" },
        installedPath: "/srv"
      });
      const result = await service.verify(server);
      expect(result).toEqual({
        ok: false,
        reason: "Checksum verification requires targetPath and expectedSha256"
      });
    });

    it("returns { ok: true } when the file hash matches expectedSha256 (case-insensitive)", async () => {
      const knownContent = Buffer.from("hello world");
      // Pre-compute the expected SHA-256 of the buffer
      const expectedHash = crypto.createHash("sha256").update(knownContent).digest("hex");

      // Mock fs.createReadStream to emit a known buffer
      const mockStream = new EventEmitter() as any;
      vi.mocked(fs.createReadStream).mockReturnValue(mockStream as any);

      const server = makeServer({
        packageVerification: {
          mode: "checksum",
          targetPath: "dist/index.js",
          expectedSha256: expectedHash.toUpperCase() // test case-insensitivity
        },
        installedPath: "/srv"
      });

      const verifyPromise = service.verify(server);

      // Emit stream events after the promise is created
      process.nextTick(() => {
        mockStream.emit("data", knownContent);
        mockStream.emit("end");
      });

      const result = await verifyPromise;
      expect(result).toEqual({ ok: true });
    });

    it("returns { ok: false } with mismatch reason when the hash does not match", async () => {
      const mockStream = new EventEmitter() as any;
      vi.mocked(fs.createReadStream).mockReturnValue(mockStream as any);

      const server = makeServer({
        packageVerification: {
          mode: "checksum",
          targetPath: "dist/index.js",
          expectedSha256: "0000000000000000000000000000000000000000000000000000000000000000"
        },
        installedPath: "/srv"
      });

      const verifyPromise = service.verify(server);

      process.nextTick(() => {
        mockStream.emit("data", Buffer.from("some other content"));
        mockStream.emit("end");
      });

      const result = await verifyPromise;
      expect(result).toEqual({ ok: false, reason: "Checksum mismatch for dist/index.js" });
    });
  });

  describe("verify — mode: signature", () => {
    it("returns { ok: false } when any required signature field is missing", async () => {
      const server = makeServer({
        packageVerification: { mode: "signature" },
        installedPath: "/srv"
      });
      const result = await service.verify(server);
      expect(result).toEqual({
        ok: false,
        reason: "Signature verification requires manifestPath, signaturePath, and publicKeyPem"
      });
    });

    it("returns { ok: true } for a valid RSA signature", async () => {
      const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;

      const manifestContent = Buffer.from("manifest content");
      const signatureB64 = crypto.sign("sha256", manifestContent, privateKey).toString("base64");

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(manifestContent as any)
        .mockResolvedValueOnce(signatureB64 as any);

      const server = makeServer({
        packageVerification: {
          mode: "signature",
          manifestPath: "manifest.txt",
          signaturePath: "manifest.sig",
          publicKeyPem
        },
        installedPath: "/srv"
      });

      const result = await service.verify(server);
      expect(result).toEqual({ ok: true });
    });

    it("returns { ok: false } when the signature is tampered", async () => {
      const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;

      const manifestContent = Buffer.from("manifest content");
      // Use a random buffer as a fake/tampered signature
      const tamperedSig = crypto.randomBytes(256).toString("base64");

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(manifestContent as any)
        .mockResolvedValueOnce(tamperedSig as any);

      const server = makeServer({
        packageVerification: {
          mode: "signature",
          manifestPath: "manifest.txt",
          signaturePath: "manifest.sig",
          publicKeyPem
        },
        installedPath: "/srv"
      });

      const result = await service.verify(server);
      expect(result).toEqual({ ok: false, reason: "Detached signature verification failed" });
    });
  });

  describe("verify — unsupported mode", () => {
    it("returns { ok: false } for an unrecognised mode string", async () => {
      const server = makeServer({
        packageVerification: { mode: "unknown" as any },
        installedPath: "/srv"
      });
      const result = await service.verify(server);
      expect(result).toEqual({ ok: false, reason: "Unsupported verification mode" });
    });
  });
});
