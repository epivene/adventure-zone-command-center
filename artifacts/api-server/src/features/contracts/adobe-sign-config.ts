export type AdobeSignReadiness = {
  draftingAvailable: true;
  signApiAvailable: boolean;
  reason: string;
  missing: string[];
  apiBaseUrl: string | null;
};

export function readAdobeSignConfig(env: NodeJS.ProcessEnv = process.env) {
  const required = [
    ["ADOBE_SIGN_CLIENT_ID", env.ADOBE_SIGN_CLIENT_ID],
    ["ADOBE_SIGN_CLIENT_SECRET", env.ADOBE_SIGN_CLIENT_SECRET],
    ["ADOBE_SIGN_REFRESH_TOKEN", env.ADOBE_SIGN_REFRESH_TOKEN],
    ["ADOBE_SIGN_ACCOUNT_ID", env.ADOBE_SIGN_ACCOUNT_ID],
    ["ADOBE_SIGN_DAVID_EMAIL", env.ADOBE_SIGN_DAVID_EMAIL],
    ["ADOBE_SIGN_WEBHOOK_SECRET", env.ADOBE_SIGN_WEBHOOK_SECRET],
  ] as const;
  const missing = required.filter(([, value]) => !value?.trim()).map(([key]) => key);
  const apiBaseUrl = env.ADOBE_SIGN_API_BASE_URL?.trim() || null;
  const signApiAvailable = Boolean(apiBaseUrl && missing.length === 0);
  return {
    clientId: env.ADOBE_SIGN_CLIENT_ID?.trim() ?? "",
    clientSecret: env.ADOBE_SIGN_CLIENT_SECRET?.trim() ?? "",
    refreshToken: env.ADOBE_SIGN_REFRESH_TOKEN?.trim() ?? "",
    accountId: env.ADOBE_SIGN_ACCOUNT_ID?.trim() ?? "",
    davidEmail: env.ADOBE_SIGN_DAVID_EMAIL?.trim() ?? "",
    davidName: env.ADOBE_SIGN_DAVID_NAME?.trim() || "David",
    webhookSecret: env.ADOBE_SIGN_WEBHOOK_SECRET?.trim() ?? "",
    apiBaseUrl: apiBaseUrl ?? "https://api.na1.adobesign.com/api/rest/v6",
    tokenUrl: env.ADOBE_SIGN_TOKEN_URL?.trim() || "https://ims-na1.adobelogin.com/ims/token/v3",
    readiness: {
      draftingAvailable: true as const,
      signApiAvailable,
      reason: signApiAvailable
        ? "Acrobat Sign API configuration is present. Provider entitlement will be confirmed by the first authenticated request."
        : "Drafting and review are available. Configure Acrobat Sign API OAuth, account, David recipient, and webhook secrets on Render to send.",
      missing,
      apiBaseUrl,
    } satisfies AdobeSignReadiness,
  };
}