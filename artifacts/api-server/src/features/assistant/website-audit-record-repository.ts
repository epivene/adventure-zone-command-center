import { pool as defaultPool } from "@workspace/db";

type QueryResult = { rows: any[] };
type QueryDb = { query(sql: string, params?: unknown[]): Promise<QueryResult> };

export const WEBSITE_AUDIT_BATCH_SIZE = 25;

export type WebsiteAuditRecord = {
  recordId: string;
  label: string;
  website: string;
  city: string | null;
  region: string | null;
  phone: string | null;
  primaryEmailDomain: string | null;
};

export interface WebsiteAuditRecordRepository {
  countApplicable(): Promise<number>;
  listBatch(input: { afterId: string | null; limit: number }): Promise<WebsiteAuditRecord[]>;
  readCurrentWebsite(recordId: string): Promise<string | null>;
}

function emailDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at >= email.length - 1) return null;
  return email.slice(at + 1);
}

export class PostgresWebsiteAuditRecordRepository implements WebsiteAuditRecordRepository {
  constructor(private readonly db: QueryDb = defaultPool as unknown as QueryDb) {}

  async countApplicable(): Promise<number> {
    const result = await this.db.query(`
      select count(*)::int as count
      from organizations o
      where o.consolidated_into_id is null
        and nullif(trim(o.website), '') is not null
    `);
    return Number(result.rows[0]?.count ?? 0);
  }

  async listBatch(input: { afterId: string | null; limit: number }): Promise<WebsiteAuditRecord[]> {
    const limit = Math.max(1, Math.min(WEBSITE_AUDIT_BATCH_SIZE, Math.floor(input.limit || WEBSITE_AUDIT_BATCH_SIZE)));
    const result = await this.db.query(`
      select
        o.id,
        o.name,
        o.website,
        o.city,
        o.region,
        o.phone,
        primary_contact.email as primary_email
      from organizations o
      left join lateral (
        select c.email
        from organization_contacts oc
        join contacts c on c.id = oc.contact_id
        where oc.organization_id = o.id
          and oc.active = true
        order by oc.is_primary desc, c.id
        limit 1
      ) primary_contact on true
      where o.consolidated_into_id is null
        and nullif(trim(o.website), '') is not null
        and ($1::uuid is null or o.id > $1::uuid)
      order by o.id
      limit $2
    `, [input.afterId, limit]);

    return result.rows.map((row) => ({
      recordId: String(row.id),
      label: String(row.name),
      website: String(row.website).trim(),
      city: row.city ?? null,
      region: row.region ?? null,
      phone: row.phone ?? null,
      primaryEmailDomain: emailDomain(row.primary_email),
    }));
  }

  async readCurrentWebsite(recordId: string): Promise<string | null> {
    const result = await this.db.query(
      `select website from organizations where id=$1 and consolidated_into_id is null`,
      [recordId],
    );
    const value = result.rows[0]?.website;
    return typeof value === "string" ? value : null;
  }
}
