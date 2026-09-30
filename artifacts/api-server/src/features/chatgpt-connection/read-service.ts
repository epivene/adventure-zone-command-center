import { z } from "zod";
import {
  activeConnection,
  requireConnectionScope,
  ConnectionError,
  inputHash,
  type ConnectionDatabase,
  type ConnectionPrincipal,
  type ProfileSummary,
  type ProfileContext,
  type ContextItem,
  type Page,
  type TextChunk,
  type SqlQuery,
} from "./contracts";
export const iso = (v: unknown) =>
  v == null ? null : new Date(String(v)).toISOString();
export const clip = (v: unknown, max = 500) =>
  v == null ? null : String(v).slice(0, max);
export function profileSummary(row: any): ProfileSummary {
  return {
    id: row.id,
    name: clip(row.name)!,
    city: clip(row.city),
    region: clip(row.region),
    website: clip(row.website, 2048),
    phone: clip(row.phone),
    revision: row.revision ?? row.updated_at_text,
    href: `/profiles/${row.id}`,
    fieldsTruncated:
      ["name", "city", "region", "phone"].some(
        (k) => String(row[k] ?? "").length > 500,
      ) || String(row.website ?? "").length > 2048,
  };
}
export async function profileRow(db: SqlQuery, id: string, lock = false) {
  if (!z.string().uuid().safeParse(id).success)
    throw new ConnectionError("CONNECTION_PROFILE_UNAVAILABLE", 404);
  const row = (
    await db.query(
      "SELECT *, updated_at::text AS revision FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL" +
        (lock ? " FOR UPDATE" : ""),
      [id],
    )
  ).rows[0];
  if (!row) throw new ConnectionError("CONNECTION_PROFILE_UNAVAILABLE", 404);
  return row;
}
function cursorEncode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function cursorDecode(value: string | undefined, scope: unknown) {
  if (!value) return null;
  try {
    if (value.length > 2000) throw Error();
    const c = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      c.scope !== inputHash(scope) ||
      !z.string().uuid().safeParse(c.id).success ||
      !Number.isFinite(Date.parse(c.at))
    )
      throw Error();
    return c;
  } catch {
    throw new ConnectionError("CONNECTION_INVALID_CURSOR");
  }
}
export class ConnectionReadService {
  constructor(private db: ConnectionDatabase) {}
  private async authorize(p: ConnectionPrincipal) {
    requireConnectionScope(p, "crm:read");
    await activeConnection(this.db, p);
  }
  async search(
    p: ConnectionPrincipal,
    input: {
      query: string;
      eventYear: number | null;
      cursor?: string;
      limit?: number;
    },
  ): Promise<Page<ProfileSummary>> {
    await this.authorize(p);
    const query = input.query?.trim() ?? "";
    if (query.length > 200)
      throw new ConnectionError("CONNECTION_INVALID_QUERY");
    const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 20)));
    const scope = ["search", query, input.eventYear],
      c = cursorDecode(input.cursor, scope);
    const rows = (
      await this.db.query(
        `SELECT id,name,city,region,website,phone,updated_at::text AS revision FROM organizations WHERE consolidated_into_id IS NULL AND (name ILIKE $1 OR city ILIKE $1) AND ($2::timestamptz IS NULL OR (updated_at,id)<($2::timestamptz,$3::uuid)) ORDER BY updated_at DESC,id DESC LIMIT $4`,
        [
          "%" + query.replace(/[\\%_]/g, "\\$&") + "%",
          c?.at ?? null,
          c?.id ?? null,
          limit + 1,
        ],
      )
    ).rows;
    const items = rows.slice(0, limit),
      last = items.at(-1);
    return {
      items: items.map(profileSummary),
      truncated: rows.length > limit,
      nextCursor:
        rows.length > limit
          ? cursorEncode({
              scope: inputHash(scope),
              at: last.revision,
              id: last.id,
            })
          : null,
    };
  }
  async context(
    p: ConnectionPrincipal,
    input: {
      profileId: string;
      eventYear: number | null;
      section?: string;
      cursor?: string;
    },
  ): Promise<ProfileContext> {
    await this.authorize(p);
    const profile = profileSummary(await profileRow(this.db, input.profileId));
    const section = input.section ?? "history";
    if (!["history", "contacts", "bookings", "documents"].includes(section))
      throw new ConnectionError("CONNECTION_INVALID_SECTION");
    const scope = [input.profileId, input.eventYear, section],
      c = cursorDecode(input.cursor, scope);
    const contactIds = `SELECT contact_id FROM organization_contacts WHERE organization_id=$1 AND active=true`,
      bookingIds = `SELECT id FROM bookings WHERE organization_id=$1`;
    let select: string;
    if (section === "history")
      select = `SELECT a.id,a.kind,a.subject,a.body,a.occurred_at,a.date_is_import_fallback,a.timeline_sort_at AS sort_at FROM activities a WHERE a.deleted_at IS NULL AND (a.organization_id=$1 OR (a.organization_id IS NULL AND (a.booking_id IN (${bookingIds}) OR (a.booking_id IS NULL AND a.contact_id IN (${contactIds})))) OR EXISTS(SELECT 1 FROM activity_associations x WHERE x.activity_id=a.id AND (x.organization_id=$1 OR x.contact_id IN (${contactIds}) OR x.booking_id IN (${bookingIds}))))`;
    else if (section === "contacts")
      select = `SELECT c.id,'contact' AS kind,c.first_name||' '||c.last_name AS subject,c.email,c.phone,oc.role,c.updated_at AS sort_at FROM contacts c JOIN organization_contacts oc ON oc.contact_id=c.id WHERE oc.organization_id=$1 AND oc.active=true`;
    else if (section === "bookings")
      select = `SELECT id,'booking' AS kind,name AS subject,status,starts_at AS occurred_at,updated_at AS sort_at FROM bookings WHERE organization_id=$1`;
    else
      select = `SELECT d.id,'document' AS kind,d.display_name AS subject,d.lifecycle AS status,d.updated_at AS sort_at FROM business_documents d WHERE d.lifecycle<>'deleted' AND EXISTS(SELECT 1 FROM business_document_links l WHERE l.document_id=d.id AND (l.organization_id=$1 OR l.booking_id IN (${bookingIds})))`;
    const rows = (
      await this.db.query(
        `SELECT r.*,sort_at::text AS cursor_at FROM (${select}) r WHERE ($2::timestamptz IS NULL OR (sort_at,id)<($2::timestamptz,$3::uuid)) ORDER BY sort_at DESC,id DESC LIMIT 11`,
        [input.profileId, c?.at ?? null, c?.id ?? null],
      )
    ).rows;
    const items: ContextItem[] = [],
      taken: any[] = [];
    let budget = JSON.stringify(profile).length + 2500;
    for (const row of rows.slice(0, 10)) {
      const text = String(row.body ?? row.subject ?? ""),
        occurredAt = row.date_is_import_fallback ? null : iso(row.occurred_at);
      const item: ContextItem = {
        id: row.id,
        kind: row.kind,
        eventYear: occurredAt ? new Date(occurredAt).getUTCFullYear() : null,
        occurredAt,
        status: clip(row.status),
        text: text.slice(0, 1500),
        excerpt: text.length > 1500,
        subject: clip(row.subject),
        email: clip(row.email),
        phone: clip(row.phone),
        recordedRole: clip(row.role),
        roleVerification:
          "Not independently verified; a recorded role is not proof of current event responsibility.",
      };
      if (budget + JSON.stringify(item).length > 22000) break;
      budget += JSON.stringify(item).length;
      items.push(item);
      taken.push(row);
    }
    const more = rows.length > items.length,
      last = taken.at(-1);
    return {
      profile,
      requestedEventYear: input.eventYear,
      sections: {
        [section]: {
          items,
          truncated: more,
          nextCursor:
            more && last
              ? cursorEncode({
                  scope: inputHash(scope),
                  at: last.cursor_at,
                  id: last.id,
                })
              : null,
        },
      },
      omittedSections: ["history", "contacts", "bookings", "documents"].filter(
        (s) => s !== section,
      ),
      complete: false,
      instruction:
        "This is one page of one section, not a complete profile history. Dates reflect recorded activity dates, not proof of an event year. Open other sections and follow nextCursor; excerpt=true means consult the original record in the app.",
    };
  }
  async documentText(
    p: ConnectionPrincipal,
    input: { profileId: string; documentId: string; cursor?: string },
  ): Promise<Page<TextChunk>> {
    await this.authorize(p);
    await profileRow(this.db, input.profileId);
    const row = (
      await this.db.query(
        `SELECT d.id,d.current_version_id,b.sha256_hex FROM business_documents d JOIN business_document_versions v ON v.id=d.current_version_id AND v.document_id=d.id JOIN business_document_blobs b ON b.id=v.blob_id AND b.validation_state='accepted' WHERE d.id=$1 AND d.lifecycle<>'deleted' AND EXISTS(SELECT 1 FROM business_document_links l LEFT JOIN bookings k ON k.id=l.booking_id WHERE l.document_id=d.id AND (l.organization_id=$2 OR k.organization_id=$2))`,
        [input.documentId, input.profileId],
      )
    ).rows[0];
    if (!row) throw new ConnectionError("CONNECTION_ACCESS_DENIED", 403);
    let cached: any;
    try {
      cached = (
        await this.db.query(
          `SELECT e.value AS evidence,x.updated_at FROM assistant_workspace_document_extractions x CROSS JOIN LATERAL jsonb_array_elements(x.result->'evidence') e WHERE x.actor_id=$1 AND x.state='completed' AND e.value->>'recordId'=$2 AND e.value->>'version'=$3 ORDER BY x.updated_at DESC LIMIT 1`,
          [p.ownerId, input.documentId, row.sha256_hex],
        )
      ).rows[0];
    } catch (error) {
      if ((error as any).code !== "42P01") throw error;
    }
    if (!cached || typeof cached.evidence?.text !== "string")
      throw new ConnectionError(
        "CONNECTION_EXTRACTION_UNAVAILABLE",
        409,
        "No saved text for the current document version. This connection does not run extraction.",
      );
    const scope = inputHash([
      input.profileId,
      input.documentId,
      row.current_version_id,
      row.sha256_hex,
      cached.updated_at,
    ]);
    let offset = 0;
    if (input.cursor) {
      try {
        const c = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
        if (
          c.scope !== scope ||
          !Number.isSafeInteger(c.offset) ||
          c.offset < 0
        )
          throw Error();
        offset = c.offset;
      } catch {
        throw new ConnectionError("CONNECTION_INVALID_CURSOR");
      }
    }
    const text = cached.evidence.text as string;
    if (offset > text.length)
      throw new ConnectionError("CONNECTION_INVALID_CURSOR");
    const next = offset + 8000;
    return {
      items: [
        {
          documentId: input.documentId,
          version: row.current_version_id,
          text: text.slice(offset, next),
          offset,
          extractedAt: iso(cached.updated_at)!,
          complete: cached.evidence.complete === true,
          eventYear: cached.evidence.eventYear ?? null,
        },
      ],
      truncated: next < text.length,
      nextCursor:
        next < text.length ? cursorEncode({ scope, offset: next }) : null,
    };
  }
}
