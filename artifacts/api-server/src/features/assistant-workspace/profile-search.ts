import type { Queryable } from "./contracts";

type ProfileSearch = {
  query: string | null;
  contactStatus: "any" | "missing" | "present" | null;
  offset: number | null;
};

/** Current canonical profiles only. Search metadata is not communication history. */
export async function searchWorkspaceProfiles(
  db: Queryable,
  input: ProfileSearch,
) {
  const query = input.query?.trim() || null;
  const like = query ? `%${query.replace(/[\\%_]/g, "\\$&")}%` : null;
  const offset = input.offset ?? 0;
  const contactStatus = input.contactStatus ?? "any";
  const rows = await db.query(
    `SELECT o.id,o.name,o.city,o.region,contact_counts.active_contact_count
     FROM organizations o
     CROSS JOIN LATERAL (
       SELECT count(*)::int AS active_contact_count
       FROM organization_contacts oc JOIN contacts c ON c.id=oc.contact_id
       WHERE oc.organization_id=o.id AND oc.active=true
     ) contact_counts
     WHERE o.consolidated_into_id IS NULL
       AND ($3::text='any'
         OR ($3::text='missing' AND contact_counts.active_contact_count=0)
         OR ($3::text='present' AND contact_counts.active_contact_count>0))
       AND ($1::text IS NULL
         OR o.name ILIKE $2 OR o.city ILIKE $2 OR o.region ILIKE $2
         OR EXISTS (
           SELECT 1 FROM organization_contacts oc JOIN contacts c ON c.id=oc.contact_id
           WHERE oc.organization_id=o.id
             AND (concat_ws(' ',c.first_name,c.last_name) ILIKE $2 OR c.email ILIKE $2 OR c.phone ILIKE $2)
         )
         OR EXISTS (SELECT 1 FROM bookings b WHERE b.organization_id=o.id AND b.name ILIKE $2)
         OR EXISTS (
           SELECT 1 FROM organization_locations ol WHERE ol.organization_id=o.id
             AND (ol.label ILIKE $2 OR ol.venue_name ILIKE $2 OR ol.act_source_label ILIKE $2)
         )
         OR EXISTS (
           SELECT 1 FROM event_family_members efm JOIN event_families ef ON ef.id=efm.family_id
           WHERE efm.organization_id=o.id
             AND (ef.name ILIKE $2 OR ef.normalized_name ILIKE $2 OR ef.description ILIKE $2)
         ))
     ORDER BY CASE WHEN lower(o.name)=lower($1::text) THEN 0 ELSE 1 END,lower(o.name),o.id
     LIMIT 21 OFFSET $4`,
    [query, like, contactStatus, offset],
  );
  const complete = rows.rows.length <= 20;
  return {
    profiles: rows.rows.slice(0, 20).map((row) => ({
      id: String(row.id),
      organizationId: String(row.id),
      kind: "organization" as const,
      label: String(row.name),
      city: row.city ?? null,
      region: row.region ?? null,
      activeContactCount: Number(row.active_contact_count),
    })),
    contactStatus,
    complete,
    nextOffset: complete ? null : offset + 20,
    historyIncluded: false,
    instruction:
      "These are canonical organization profiles. activeContactCount counts currently active linked contact records, even when their email or phone is blank. Zero means no active contact listed, not never contacted. Communication history has not been checked; do not infer it from search results or older null metadata. Select organizationId with select_profiles before read_profile to verify current details. Use read_profile_history and relevant email evidence for outreach-history questions. complete and nextOffset describe this search page only.",
  };
}
