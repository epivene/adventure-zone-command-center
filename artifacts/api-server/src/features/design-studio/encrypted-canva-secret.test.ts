import { describe, expect, it } from "vitest";
import {
  decryptCanvaSecret,
  encryptCanvaSecret,
  parseCanvaEncryptionKey,
} from "./encrypted-canva-secret";

describe("encrypted Canva secrets", () => {
  it("round-trips a token without storing plaintext", () => {
    const key = new Uint8Array(32).fill(7);
    const encrypted = encryptCanvaSecret("refresh-token-value", key);
    expect(encrypted.ciphertext).not.toContain("refresh-token-value");
    expect(decryptCanvaSecret(encrypted, key)).toBe("refresh-token-value");
  });

  it("accepts a 32-byte hex encryption key", () => {
    const key = parseCanvaEncryptionKey("ab".repeat(32));
    expect(key.byteLength).toBe(32);
  });

  it("rejects missing encryption keys", () => {
    expect(() => parseCanvaEncryptionKey(undefined)).toThrow("CANVA_TOKEN_ENCRYPTION_KEY_REQUIRED");
  });
});
