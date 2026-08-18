import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";
import type {
  AssistantProfileSearchResult,
  ProfileSearchRequest,
} from "./profile-search-types";

export interface ProfileSearchRepository {
  search(input: ProfileSearchRequest): Promise<AssistantProfileSearchResult[]>;
}

function normalized(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function rankResult(result: AssistantProfileSearchResult, query: string): number {
  const q = normalized(query);
  const label = normalized(result.label);
  if (label === q) return 1000;
  if (label.startsWith(q)) return 850;
  if (label.includes(q)) return 700;
  let score = 0;
  if (result.matchedOn.includes("contact")) score += 500;
  if (result.matchedOn.includes("family")) score += 450;
  if (result.matchedOn.includes("city") || result.matchedOn.includes("region")) score += 300;
  if (result.matchedOn.includes("package")) score += 250;
  if (result.matchedOn.includes("overdue_follow_up")) score += 200;
  return score;
}

export function rankProfileSearchResults(
  rows: AssistantProfileSearchResult[],
  query: string,
  limit = 8,
) {
  const canonical = new Map<string, AssistantProfileSearchResult>();
  for (const row of rows) {
    const key = `${row.kind}:${row.id}`;
    const existing = canonical.get(key);
    if (!existing || rankResult(row, query) > rankResult(existing, query)) {
      canonical.set(key, row);
    }
  }
  return [...canonical.values()]
    .sort((a, b) =>
      rankResult(b, query) - rankResult(a, query) ||
      a.label.localeCompare(b.label),
    )
    .slice(0, Math.max(1, Math.min(limit, 20)));
}

export class PostgresProfileSearchRepository implements ProfileSearchRepository {
  constructor(private readonly pool: Pool = defaultPool) {}

  async search(input: ProfileSearchRequest): Promise<AssistantProfileSearchResult[]> {
    const query = input.query.trim();
    const like = `%${query}%`;
    const city = input.city?.trim() || null;
    const region = input.region?.trim() || null;
    const packageName = input.packageName?.trim() || null;
    const overdue = input.overdueFollowUp === true;

    const result = await this.pool.query(
      `WITH organization_rows AS (
         SELECT o.id,
                'organization'::text AS kind,
                o.name AS label,
                NULL::text AS secondary_label,
                o.city,
                o.region,
                (
                  SELECT b.status FROM bookings b
                  WHERE b.organization_id=o.id
                  ORDER BY b.starts_at DESC NULLS LAST, b.created_at DESC
                  LIMIT 1
                ) AS status,
                NULL::timestamptz AS last_contact_at,
                (SELECT count(*)::int FROM bookings b WHERE b.organization_id=o.id) AS booking_count,
                ARRAY_REMOVE(ARRAY[
                  CASE WHEN lower(o.name)=lower($1) OR o.name ILIKE $2 THEN 'name' END,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM organization_contacts oc
                    JOIN contacts c ON c.id=oc.contact_id
                    WHERE oc.organization_id=o.id
                      AND concat_ws(' ',c.first_name,c.last_name) ILIKE $2
                  ) THEN 'contact' END,
                  CASE WHEN o.city ILIKE COALESCE($3,o.city) AND $3 IS NOT NULL THEN 'city' END,
                  CASE WHEN o.region ILIKE COALESCE($4,o.region) AND $4 IS NOT NULL THEN 'region' END,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM event_family_members efm
                    JOIN event_families ef ON ef.id=efm.family_id
                    WHERE efm.organization_id=o.id AND ef.name ILIKE $2
                  ) THEN 'family' END,
                  CASE WHEN $5 IS NOT NULL AND EXISTS (
                    SELECT 1 FROM bookings b
                    JOIN booking_package_selections bps ON bps.booking_id=b.id
                    JOIN package_templates pt ON pt.id=bps.package_template_id
                    WHERE b.organization_id=o.id AND pt.name ILIKE '%' || $5 || '%'
                  ) THEN 'package' END,
                  CASE WHEN $6 AND EXISTS (
                    SELECT 1 FROM follow_ups f
                    WHERE f.organization_id=o.id AND f.completed_at IS NULL AND f.due_at < now()
                  ) THEN 'overdue_follow_up' END
                ],NULL) AS matched_on
         FROM organizations o
         WHERE o.consolidated_into_id IS NULL
           AND ($3 IS NULL OR o.city ILIKE $3)
           AND ($4 IS NULL OR o.region ILIKE $4)
           AND ($5 IS NULL OR EXISTS (
             SELECT 1 FROM bookings b
             JOIN booking_package_selections bps ON bps.booking_id=b.id
             JOIN package_templates pt ON pt.id=bps.package_template_id
             WHERE b.organization_id=o.id AND pt.name ILIKE '%' || $5 || '%'
           ))
           AND (NOT $6 OR EXISTS (
             SELECT 1 FROM follow_ups f
             WHERE f.organization_id=o.id AND f.completed_at IS NULL AND f.due_at < now()
           ))
           AND (
             o.name ILIKE $2
             OR o.city ILIKE $2
             OR o.region ILIKE $2
             OR EXISTS (
               SELECT 1 FROM organization_contacts oc
               JOIN contacts c ON c.id=oc.contact_id
               WHERE oc.organization_id=o.id
                 AND (concat_ws(' ',c.first_name,c.last_name) ILIKE $2 OR c.email ILIKE $2 OR c.phone ILIKE $2)
             )
             OR EXISTS (
               SELECT 1 FROM event_family_members efm
               JOIN event_families ef ON ef.id=efm.family_id
               WHERE efm.organization_id=o.id AND ef.name ILIKE $2
             )
             OR $5 IS NOT NULL OR $6
           )
       ), contact_rows AS (
         SELECT c.id,
                'contact'::text AS kind,
                trim(concat_ws(' ',c.first_name,c.last_name)) AS label,
                o.name AS secondary_label,
                COALESCE(o.city,c.city) AS city,
                COALESCE(o.region,c.region) AS region,
                NULL::text AS status,
                NULL::timestamptz AS last_contact_at,
                NULL::int AS booking_count,
                ARRAY['contact']::text[] AS matched_on
         FROM contacts c
         LEFT JOIN organization_contacts oc ON oc.contact_id=c.id
         LEFT JOIN organizations o ON o.id=oc.organization_id AND o.consolidated_into_id IS NULL
         WHERE ($3 IS NULL OR COALESCE(o.city,c.city) ILIKE $3)
           AND ($4 IS NULL OR COALESCE(o.region,c.region) ILIKE $4)
           AND (concat_ws(' ',c.first_name,c.last_name) ILIKE $2 OR c.email ILIKE $2 OR c.phone ILIKE $2)
       ), family_rows AS (
         SELECT ef.id,
                'event_family'::text AS kind,
                ef.name AS label,
                NULL::text AS secondary_label,
                NULL::text AS city,
                NULL::text AS region,
                NULL::text AS status,
                NULL::timestamptz AS last_contact_at,
                (SELECT count(*)::int FROM event_family_members x WHERE x.family_id=ef.id) AS booking_count,
                ARRAY['family']::text[] AS matched_on
         FROM event_families ef
         WHERE ef.name ILIKE $2
            OR EXISTS (
              SELECT 1 FROM event_family_members efm
              JOIN organizations o ON o.id=efm.organization_id
              WHERE efm.family_id=ef.id AND o.name ILIKE $2
            )
       )
       SELECT * FROM organization_rows
       UNION ALL SELECT * FROM contact_rows
       UNION ALL SELECT * FROM family_rows
       LIMIT 80`,
      [query, like, city, region, packageName, overdue],
    );

    const rows: AssistantProfileSearchResult[] = result.rows.map((row) => ({
      id: String(row.id),
      kind: row.kind,
      label: String(row.label ?? "Unnamed profile"),
      secondaryLabel: row.secondary_label ?? null,
      city: row.city ?? null,
      region: row.region ?? null,
      status: row.status ?? null,
      lastContactAt: row.last_contact_at ? new Date(row.last_contact_at).toISOString() : null,
      bookingCount: row.booking_count == null ? null : Number(row.booking_count),
      matchedOn: Array.isArray(row.matched_on) ? row.matched_on : [],
    }));

    return rankProfileSearchResults(rows, query, input.limit || 8);
  }
}
