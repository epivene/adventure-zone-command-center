import { describe, expect, it } from "vitest";

import {
  decryptGoogleSecret,
  encryptGoogleSecret,
} from "./encrypted-google-secret";

const key = new Uint8Array(Buffer.alloc(32, 4));

describe("encrypted Google secrets", () => {
  it("round-trips a refresh token without storing plaintext", () => {
    const plaintext = "1//company-google-refresh-token";
    const encrypted = encryptGoogleSecret(plaintext, key);

    expect(encrypted).toEqual({
      version: 1,
      algorithm: "aes-256-gcm",
      iv: expect.any(String),
      tag: expect.any(String),
      ciphertext: expect.any(String),
    });
    expect(JSON.stringify(encrypted)).not.toContain(plaintext);
    expect(decryptGoogleSecret(encrypted, key)).toBe(plaintext);
  });

  it("uses a fresh IV for every encryption", () => {
    const first = encryptGoogleSecret("same-token", key);
    const second = encryptGoogleSecret("same-token", key);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() =>
      encryptGoogleSecret("token", new Uint8Array(31)),
    ).toThrow("GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_INVALID");
  });

  it("fails closed for a wrong key", () => {
    const encrypted = encryptGoogleSecret("token", key);

    expect(() =>
      decryptGoogleSecret(encrypted, new Uint8Array(Buffer.alloc(32, 8))),
    ).toThrow("GOOGLE_WORKSPACE_SECRET_DECRYPT_FAILED");
  });

  it("fails closed when authenticated ciphertext is altered", () => {
    const encrypted = encryptGoogleSecret("token", key);
    const tampered = {
      ...encrypted,
      tag: Buffer.alloc(16, 1).toString("base64url"),
    };

    expect(() => decryptGoogleSecret(tampered, key)).toThrow(
      "GOOGLE_WORKSPACE_SECRET_DECRYPT_FAILED",
    );
  });
});
