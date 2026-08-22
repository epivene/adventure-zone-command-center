export type GoogleWorkspaceEnvironment = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  appOrigin: string;
  tokenEncryptionKey: Uint8Array;
};

export type GoogleWorkspaceEnvironmentResult =
  | { configured: false }
  | { configured: true; value: GoogleWorkspaceEnvironment };

const requiredKeys = [
  "GOOGLE_WORKSPACE_CLIENT_ID",
  "GOOGLE_WORKSPACE_CLIENT_SECRET",
  "GOOGLE_WORKSPACE_REDIRECT_URI",
  "GOOGLE_WORKSPACE_APP_ORIGIN",
  "GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY",
] as const;

const googleWorkspaceCallbackPath =
  "/api/google-workspace/oauth/callback";

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

function isTestLocalhost(url: URL, nodeEnvironment: string): boolean {
  return (
    nodeEnvironment === "test" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
  );
}

function validateRedirectUri(value: string, nodeEnvironment: string): string {
  let redirectUri: URL;
  try {
    redirectUri = new URL(value);
  } catch {
    throw new Error("GOOGLE_WORKSPACE_REDIRECT_URI_INVALID");
  }

  if (redirectUri.protocol !== "https:" && !isTestLocalhost(redirectUri, nodeEnvironment)) {
    throw new Error("GOOGLE_WORKSPACE_REDIRECT_URI_MUST_USE_HTTPS");
  }
  if (
    redirectUri.username ||
    redirectUri.password ||
    redirectUri.pathname !== googleWorkspaceCallbackPath ||
    redirectUri.search ||
    redirectUri.hash
  ) {
    throw new Error("GOOGLE_WORKSPACE_REDIRECT_URI_INVALID");
  }

  return redirectUri.toString();
}

function validateAppOrigin(value: string, nodeEnvironment: string): string {
  let appUrl: URL;
  try {
    appUrl = new URL(value);
  } catch {
    throw new Error("GOOGLE_WORKSPACE_APP_ORIGIN_INVALID");
  }

  if (appUrl.protocol !== "https:" && !isTestLocalhost(appUrl, nodeEnvironment)) {
    throw new Error("GOOGLE_WORKSPACE_APP_ORIGIN_MUST_USE_HTTPS");
  }

  if (
    appUrl.username ||
    appUrl.password ||
    appUrl.pathname !== "/" ||
    appUrl.search ||
    appUrl.hash
  ) {
    throw new Error("GOOGLE_WORKSPACE_APP_ORIGIN_INVALID");
  }

  return appUrl.origin;
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

  const nodeEnvironment = clean(env.NODE_ENV);
  return {
    configured: true,
    value: {
      clientId: values.GOOGLE_WORKSPACE_CLIENT_ID,
      clientSecret: values.GOOGLE_WORKSPACE_CLIENT_SECRET,
      redirectUri: validateRedirectUri(
        values.GOOGLE_WORKSPACE_REDIRECT_URI,
        nodeEnvironment,
      ),
      appOrigin: validateAppOrigin(
        values.GOOGLE_WORKSPACE_APP_ORIGIN,
        nodeEnvironment,
      ),
      tokenEncryptionKey: decodeEncryptionKey(
        values.GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY,
      ),
    },
  };
}
