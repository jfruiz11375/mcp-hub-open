import crypto from "node:crypto";
import type { EnvVarField } from "../types/server.js";
import { config } from "../config.js";

const PREFIX = "enc:v1";

function deriveKey(): Buffer {
  return crypto.createHash("sha256").update(config.vaultMasterKey).digest();
}

function b64(input: Buffer): string {
  return input.toString("base64url");
}

function fromB64(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export class VaultService {
  encrypt(plainText: string): string {
    const key = deriveKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}:${b64(iv)}:${b64(tag)}:${b64(encrypted)}`;
  }

  decrypt(secretText: string): string {
    if (!secretText.startsWith(`${PREFIX}:`)) return secretText;
    const [, ivText, tagText, payloadText] = secretText.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), fromB64(ivText));
    decipher.setAuthTag(fromB64(tagText));
    const plain = Buffer.concat([decipher.update(fromB64(payloadText)), decipher.final()]);
    return plain.toString("utf8");
  }

  encryptEnv(env: EnvVarField[]): EnvVarField[] {
    return env.map((item) => ({
      ...item,
      value: item.secret && item.value ? this.encrypt(item.value) : item.value
    }));
  }

  decryptEnv(env: EnvVarField[]): EnvVarField[] {
    return env.map((item) => ({
      ...item,
      value: item.secret ? this.decrypt(item.value) : item.value
    }));
  }

  sanitizeEnv(env: EnvVarField[]): EnvVarField[] {
    return env.map((item) => ({
      ...item,
      value: item.secret ? (item.value ? "********" : "") : item.value
    }));
  }
}
