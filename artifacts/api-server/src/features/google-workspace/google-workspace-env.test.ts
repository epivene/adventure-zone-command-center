import { describe, expect, it } from "vitest";

import { getGoogleWorkspaceEnvironment } from "./google-workspace-env";

const validKey = Buffer.alloc(32, 7).toString("base64");

function completeEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "test",
    GOOGLE_WORKSPACE_CLIENT_ID: "client-id.apps.googleusercontent.com",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "client-secret",
    GOOGLE_WORKSPACE_REDIRECT_URI:
      "https://api.example.com/api/google-workspace/oauth/callback",
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: validKey,
    ...overrides,
  };
}

describe("getGoogleWorkspaceEnvironment", () => {
  it("returns not configured when every Google Workspace setting is absent", () => {
    expect(getGoogleWorkspaceEnvironment({})).toEqual({ configured: false });
  });

  it("accepts a complete read-only Google Workspace configuration", () => {
    const result = getGoogleWorkspaceEnvironment(completeEnvironment());

    expect(result).toEqual({
      configured: true,
      value: {
        clientId: "client-id.apps.googleusercontent.com",
        clientSecret: "client-secret",
        redirectUri: "https://api.example.com/api/google-workspace/oauth/callback",
        tokenEncryptionKey: expect.any(Uint8Array),
      },
    });
    if (result.configured) {
      expect(result.value.tokenEncryptionKey).toHaveLength(32);
    }
  });

  it("rejects a partially configured environment", () => {
    expect(() =>
      getGoogleWorkspaceEnvironment({
        GOOGLE_WORKSPACE_CLIENT_ID: "client-id.apps.googleusercontent.com",
      }),
    ).toThrow("GOOGLE_WORKSPACE_CONFIGURATION_INCOMPLETE");
  });

  it("rejects an encryption key that is not exactly 32 bytes", () => {
    expect(() =>
      getGoogleWorkspaceEnvironment(
        completeEnvironment({
          GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64"),
        }),
      ),
    ).toThrow("GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_INVALID");
  });

  it("requires an HTTPS callback outside tests", () => {
    expect(() =>
      getGoogleWorkspaceEnvironment(
        completeEnvironment({
          NODE_ENV: "production",
          GOOGLE_WORKSPACE_REDIRECT_URI:
            "http://api.example.com/api/google-workspace/oauth/callback",
        }),
      ),
    ).toThrow("GOOGLE_WORKSPACE_REDIRECT_URI_MUST_USE_HTTPS");
  });

  it("permits an HTTP localhost callback during tests", () => {
    const result = getGoogleWorkspaceEnvironment(
      completeEnvironment({
        GOOGLE_WORKSPACE_REDIRECT_URI:
          "http://localhost:3000/api/google-workspace/oauth/callback",
      }),
    );

    expect(result.configured).toBe(true);
  });

  it("never includes secret values in configuration errors", () => {
    const secret = "do-not-print-this-client-secret";

    try {
      getGoogleWorkspaceEnvironment(
        completeEnvironment({
          GOOGLE_WORKSPACE_CLIENT_SECRET: secret,
          GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: "not-base64!",
        }),
      );
      throw new Error("Expected configuration parsing to fail");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
