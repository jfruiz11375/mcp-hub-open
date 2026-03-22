import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import type { ManagedServer } from "../types/server.js";

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export class SignatureService {
  async verify(server: ManagedServer): Promise<{ ok: true } | { ok: false; reason: string }> {
    const verification = server.packageVerification;
    if (!verification || verification.mode === "none") return { ok: true };

    const baseDir = server.workingDirectory || server.installedPath;
    if (!baseDir) return { ok: false, reason: "No installed path available for verification" };

    if (verification.mode === "checksum") {
      if (!verification.targetPath || !verification.expectedSha256) {
        return { ok: false, reason: "Checksum verification requires targetPath and expectedSha256" };
      }
      const target = path.join(baseDir, verification.targetPath);
      const actual = await sha256File(target);
      return actual.toLowerCase() === verification.expectedSha256.toLowerCase()
        ? { ok: true }
        : { ok: false, reason: `Checksum mismatch for ${verification.targetPath}` };
    }

    if (verification.mode === "signature") {
      if (!verification.manifestPath || !verification.signaturePath || !verification.publicKeyPem) {
        return { ok: false, reason: "Signature verification requires manifestPath, signaturePath, and publicKeyPem" };
      }
      const manifestBuffer = await fs.readFile(path.join(baseDir, verification.manifestPath));
      const signature = await fs.readFile(path.join(baseDir, verification.signaturePath), "utf8");
      const verified = crypto.verify(
        "sha256",
        manifestBuffer,
        verification.publicKeyPem,
        Buffer.from(signature.trim(), "base64")
      );
      return verified ? { ok: true } : { ok: false, reason: "Detached signature verification failed" };
    }

    return { ok: false, reason: "Unsupported verification mode" };
  }
}
