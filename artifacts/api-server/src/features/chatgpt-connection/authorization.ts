import {
  ConnectionError,
  connectionScopes,
  type ConnectionPrincipal,
  type SqlQuery,
} from "./contracts";
export { requireConnectionScope } from "./contracts";
type AccessToken = {
  accountId?: string;
  clientId?: string;
  grantId?: string;
  aud?: string | string[];
  scope?: string;
  exp?: number;
};
export async function verifyConnectionAccessToken(
  token: string,
  deps: {
    resource: string;
    db: SqlQuery;
    find: (token: string) => Promise<AccessToken | undefined>;
  },
): Promise<ConnectionPrincipal> {
  const denied = () => new ConnectionError("CONNECTION_ACCESS_DENIED", 401);
  if (!token || token.length > 4096 || token.startsWith("owner."))
    throw denied();
  const value = await deps.find(token);
  if (
    !value ||
    value.aud !== deps.resource ||
    !value.exp ||
    value.exp <= Date.now() / 1000 ||
    !value.grantId
  )
    throw denied();
  const row = (
    await deps.db.query("SELECT * FROM chatgpt_connections WHERE grant_id=$1", [
      value.grantId,
    ])
  ).rows[0];
  if (
    !row ||
    row.revoked_at ||
    row.owner_id !== value.accountId ||
    row.client_id !== value.clientId
  )
    throw denied();
  const scopes = (value.scope ?? "").split(" ").filter(Boolean);
  if (
    !scopes.length ||
    !scopes.every(
      (s) => connectionScopes.includes(s as any) && row.scopes.includes(s),
    )
  )
    throw denied();
  return {
    ownerId: row.owner_id,
    connectionId: row.id,
    clientId: row.client_id,
    scopes: scopes as ConnectionPrincipal["scopes"],
  };
}
