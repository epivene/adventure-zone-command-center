import { createHash } from "node:crypto";
export type ConnectionScope =
  "crm:read" | "crm:append" | "crm:update" | "drafts:write" | "followups:write" | "email:organize";
export const connectionScopes: ConnectionScope[] = [
  "crm:read",
  "crm:append",
  "crm:update",
  "drafts:write",
  "followups:write",
  "email:organize",
];
export type ConnectionPrincipal = {
  ownerId: string;
  connectionId: string;
  clientId: string;
  scopes: ConnectionScope[];
};
export type SourceRef = {
  url: string;
  retrievedAt: string;
  eventYear: number | null;
  claim: string;
  verification: "verified" | "unverified";
};
export type OperationReceipt<T> = {
  operationId: string;
  recordId: string;
  href: string;
  revision: string;
  savedAt: string;
  value: T;
};
export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  truncated: boolean;
};
export type MutationKey = { requestKey: string };
export class ConnectionError extends Error {
  constructor(
    public code: string,
    public status = 400,
    message = code,
  ) {
    super(message);
    this.name = "ConnectionError";
  }
}
export interface SqlQuery {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}
export interface ConnectionDatabase extends SqlQuery {
  connect?(): Promise<SqlQuery & { release(): void }>;
  transaction?<T>(work: (tx: SqlQuery) => Promise<T>): Promise<T>;
}
export async function transaction<T>(
  db: ConnectionDatabase,
  work: (tx: SqlQuery) => Promise<T>,
): Promise<T> {
  if (db.transaction) return db.transaction(work);
  if (!db.connect)
    throw new Error("Connection database requires a pinned transaction");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
export const inputHash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export async function activeConnection(
  db: SqlQuery,
  p: ConnectionPrincipal,
  lock = false,
) {
  const row = (
    await db.query(
      "SELECT * FROM chatgpt_connections WHERE id=$1 AND owner_id=$2 AND client_id=$3" +
        (lock ? " FOR UPDATE" : ""),
      [p.connectionId, p.ownerId, p.clientId],
    )
  ).rows[0];
  if (!row) throw new ConnectionError("CONNECTION_ACCESS_DENIED", 403);
  if (row.revoked_at) throw new ConnectionError("CONNECTION_REVOKED", 401);
  if (!p.scopes.every((s) => row.scopes.includes(s)))
    throw new ConnectionError("CONNECTION_ACCESS_DENIED", 403);
  return row;
}
export function requireConnectionScope(
  p: ConnectionPrincipal,
  scope: ConnectionScope,
) {
  if (!p.scopes.includes(scope))
    throw new ConnectionError("CONNECTION_ACCESS_DENIED", 403);
}

export type ProfileSummary = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  website: string | null;
  phone: string | null;
  revision: string;
  href: string;
  fieldsTruncated: boolean;
};
export type ContextItem = {
  id: string;
  eventYear: number | null;
  occurredAt: string | null;
  status: string | null;
  text: string;
  excerpt: boolean;
  kind: string;
  [key: string]: unknown;
};
export type ProfileContext = {
  profile: ProfileSummary;
  requestedEventYear: number | null;
  sections: Record<string, Page<ContextItem>>;
  omittedSections: string[];
  complete: false;
  instruction: string;
};
export type TextChunk = {
  documentId: string;
  version: string;
  text: string;
  offset: number;
  extractedAt: string;
  complete: boolean;
  eventYear: number | null;
};
