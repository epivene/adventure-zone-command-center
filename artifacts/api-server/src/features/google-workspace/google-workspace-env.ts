export type GoogleWorkspaceEnvironment = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncryptionKey: Uint8Array;
};

export type GoogleWorkspaceEnvironmentResult =
  | { configured: false }
  | { configured: true; value: GoogleWorkspaceEnvironment };

const requiredKeys = [
  "GOOGLE_WORKSPACE_CLIENT_ID",
  "GOOGLE_WORKSPACE_CLIENT_SECRET",
  "GOOGLE_WORKSPACE_REDIRECT_URI",
  "GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY",
] as const;

type GoogleWorkspaceEnvironmentKey = (typeof requiredKeys)[number];
type EnvironmentInput = Record<string, string | undefined>;

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

function decodeEncryptionKey(value: string): Uint8Array {
  const validBase64 =
    value.length > 0 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  if (!validBase64) {
    throw new Error("GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_INVALID");
  }

  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value) {
    throw new Error("GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_INVALID");
  }
  return new Uint8Array(bytes);
}

function validateRedirectUri(value: string, nodeEnvironment: string): string {
  let redirectUri: URL;
  try {
    redirectUri = new URL(value);
  } catch {
    throw new Error("GOOGLE_WORKSPACE_REDIRECT_URI_INVALID");
  }

  const testLocalhost =
    nodeEnvironment === "test" &&
    redirectUri.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(redirectUri.hostname);

  if (redirectUri.protocol !== "https:" && !testLocalhost) {
    throw new Error("GOOGLE_WORKSPACE_REDIRECT_URI_MUST_USE_HTTPS");
  }

  return redirectUri.toString();
}

export function getGoogleWorkspaceEnvironment(
  env: EnvironmentInput = process.env,
): GoogleWorkspaceEnvironmentResult {
  const values = Object.fromEntries(
    requiredKeys.map((key) => [key, clean(env[key])]),
  ) as Record<GoogleWorkspaceEnvironmentKey, string>;

  const configuredCount = requiredKeys.filter((key) => values[key]).length;
  if (configuredCount === 0) return { configured: false };
  if (configuredCount !== requiredKeys.length) {
    throw new Error("GOOGLE_WORKSPACE_CONFIGURATION_INCOMPLETE");
  }

  return {
    configured: true,
    value: {
      clientId: values.GOOGLE_WORKSPACE_CLIENT_ID,
      clientSecret: values.GOOGLE_WORKSPACE_CLIENT_SECRET,
      redirectUri: validateRedirectUri(
        values.GOOGLE_WORKSPACE_REDIRECT_URI,
        clean(env.NODE_ENV),
      ),
      tokenEncryptionKey: decodeEncryptionKey(
        values.GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY,
      ),
    },
  };
}
