import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

export type EncryptedCanvaSecretV1 = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
};

const algorithm = "aes-256-gcm" as const;
const additionalAuthenticatedData = Buffer.from(
  "adventure-zone:canva-connect-token:v1",
  "utf8",
);

function encryptionKey(key: Uint8Array): Buffer {
  if (key.byteLength !== 32) {
    throw new Error("CANVA_TOKEN_ENCRYPTION_KEY_INVALID");
  }
  return Buffer.from(key);
}

export function parseCanvaEncryptionKey(value: string | undefined): Uint8Array {
  if (!value) throw new Error("CANVA_TOKEN_ENCRYPTION_KEY_REQUIRED");

  const trimmed = value.trim();
  const decoded = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64url");

  if (decoded.byteLength !== 32) {
    throw new Error("CANVA_TOKEN_ENCRYPTION_KEY_INVALID");
  }
  return decoded;
}

export function encryptCanvaSecret(
  plaintext: string,
  key: Uint8Array,
): EncryptedCanvaSecretV1 {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, encryptionKey(key), iv);
  cipher.setAAD(additionalAuthenticatedData);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    version: 1,
    algorithm,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function decryptCanvaSecret(
  payload: EncryptedCanvaSecretV1,
  key: Uint8Array,
): string {
  try {
    if (payload.version !== 1 || payload.algorithm !== algorithm) {
      throw new Error("unsupported encrypted secret format");
    }

    const iv = Buffer.from(payload.iv, "base64url");
    const tag = Buffer.from(payload.tag, "base64url");
    const ciphertext = Buffer.from(payload.ciphertext, "base64url");
    if (iv.byteLength !== 12 || tag.byteLength !== 16) {
      throw new Error("invalid encrypted secret dimensions");
    }

    const decipher = createDecipheriv(algorithm, encryptionKey(key), iv);
    decipher.setAAD(additionalAuthenticatedData);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "CANVA_TOKEN_ENCRYPTION_KEY_INVALID"
    ) {
      throw error;
    }
    throw new Error("CANVA_SECRET_DECRYPT_FAILED");
  }
}
