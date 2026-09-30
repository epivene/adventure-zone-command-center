import Provider, { errors, type Configuration } from "oidc-provider";
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  connectionScopes,
  ConnectionError,
  type ConnectionScope,
} from "./contracts";
import { OAuthStore } from "./oauth-store";
export type ConnectionOAuthConfig = {
  issuer: string;
  resource: string;
  appOrigin: string;
  cookieKeys: string[];
  jwks: NonNullable<Configuration["jwks"]>;
};
export function createConnectionOAuthProvider(
  config: ConnectionOAuthConfig,
  store: OAuthStore,
) {
  for (const value of [config.issuer, config.resource, config.appOrigin]) {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.hash ||
      u.search
    )
      throw new Error("Connection URLs must use fixed HTTPS origins");
  }
  if (
    new URL(config.issuer).origin !== new URL(config.resource).origin ||
    new URL(config.appOrigin).origin !== config.appOrigin ||
    !config.cookieKeys[0]
  )
    throw new Error("Connection origin or cookie key invalid");
  const provider = new Provider(config.issuer, {
    adapter: (name) => store.adapter(name),
    jwks: config.jwks,
    responseTypes: ["code"],
    scopes: ["openid", "offline_access"],
    claims: { openid: ["sub"] },
    cookies: {
      keys: config.cookieKeys,
      short: { path: "/", httpOnly: true, sameSite: "lax", secure: true },
      long: { path: "/", httpOnly: true, sameSite: "lax", secure: true },
    },
    pkce: { required: () => true },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true },
      userinfo: { enabled: false },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => config.resource,
        useGrantedResource: () => true,
        getResourceServerInfo: async (_ctx, resource) => {
          if (resource !== config.resource) throw new errors.InvalidTarget();
          return {
            scope: connectionScopes.join(" "),
            audience: config.resource,
            accessTokenTTL: 300,
            accessTokenFormat: "opaque",
          };
        },
      },
    },
    ttl: {
      AccessToken: 300,
      AuthorizationCode: 60,
      Interaction: 600,
      Session: 3600,
      Grant: 30 * 86400,
      RefreshToken: (_ctx, token) =>
        Math.max(
          0,
          30 * 86400 - (Math.floor(Date.now() / 1000) - (token as any).iiat),
        ),
    },
    rotateRefreshToken: true,
    issueRefreshToken: (_ctx, client) =>
      client.grantTypeAllowed("refresh_token"),
    expiresWithSession: () => false,
    findAccount: async (_ctx, id) =>
      id === "owner"
        ? { accountId: id, claims: async () => ({ sub: id }) }
        : undefined,
    interactions: {
      url: (_ctx, interaction) =>
        `${new URL(config.issuer).origin}/chatgpt-connection/consent?interaction=${encodeURIComponent(interaction.uid)}`,
    },
    renderError: async (ctx) => {
      ctx.type = "application/json";
      ctx.body = {
        error: "authorization_failed",
        message:
          "The connection request could not be authorized. Start again from your client.",
      };
    },
  });
  provider.proxy = true;
  async function details(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
  ) {
    const d = await provider.interactionDetails(req, res);
    if (d.uid !== uid)
      throw new ConnectionError("CONNECTION_INTERACTION_MISMATCH", 403);
    const client = (
      await store.db.query(
        "SELECT metadata FROM chatgpt_oauth_clients WHERE id=$1 AND owner_id=$2",
        [d.params.client_id, "owner"],
      )
    ).rows[0];
    if (!client) throw new ConnectionError("CONNECTION_ACCESS_DENIED", 403);
    const requested = String(d.params.scope ?? "")
      .split(" ")
      .filter((s): s is ConnectionScope =>
        connectionScopes.includes(s as ConnectionScope),
      );
    return { d, client, requested };
  }
  async function consent(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    selected: ConnectionScope[],
    approve: boolean,
  ) {
    const { d, requested } = await details(req, res, uid);
    if (!approve)
      return provider.interactionResult(
        req,
        res,
        {
          error: "access_denied",
          error_description: "The owner declined access",
        },
        { mergeWithLastSubmission: false },
      );
    if (
      !selected.length ||
      new Set(selected).size !== selected.length ||
      !selected.every((s) => requested.includes(s))
    )
      throw new ConnectionError("CONNECTION_INVALID_SCOPE");
    const grant = new provider.Grant({
      accountId: "owner",
      clientId: String(d.params.client_id),
    });
    grant.jti = randomBytes(32).toString("base64url");
    await store.db.query(
      "INSERT INTO chatgpt_connections(id,owner_id,client_id,scopes,grant_id) VALUES($1,$2,$3,$4::jsonb,$5)",
      [
        randomUUID(),
        "owner",
        d.params.client_id,
        JSON.stringify(selected),
        grant.jti,
      ],
    );
    try {
      grant.addOIDCScope(
        String(d.params.scope ?? "")
          .split(" ")
          .filter((s) => ["openid", "offline_access"].includes(s))
          .join(" "),
      );
      grant.addResourceScope(config.resource, selected.join(" "));
      grant.rejectResourceScope(
        config.resource,
        requested.filter((s) => !selected.includes(s)).join(" "),
      );
      const grantId = await grant.save();
      return await provider.interactionResult(
        req,
        res,
        { login: { accountId: "owner" }, consent: { grantId } },
        { mergeWithLastSubmission: false },
      );
    } catch (error) {
      await store.revokeGrant(grant.jti);
      throw error;
    }
  }
  return { provider, details, consent, config, store };
}
export type ConnectionOAuth = ReturnType<typeof createConnectionOAuthProvider>;
