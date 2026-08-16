import type { Pool } from "pg";

export type FamilySharedContact = {
  familyId: string;
  familyName: string;
  website: string | null;
  primaryContact: {
    contactId: string;
    name: string;
    role: string | null;
    phone: string | null;
    email: string | null;
  } | null;
};

type FamilyContext = { kind: "event_family" | "organization_group"; id: string; name: string } | null;

export async function getFamilySharedContact(pool: Pick<Pool, "query">, context: FamilyContext): Promise<FamilySharedContact | null> {
  if (context?.kind !== "event_family") return null;
  const result = await pool.query(`
    SELECT f.id AS "familyId", f.name AS "familyName", f.website,
           efc.contact_id AS "contactId",
           concat_ws(' ', c.first_name, c.last_name) AS "contactName",
           efc.role, c.phone, c.email
    FROM event_families f
    LEFT JOIN event_family_contacts efc ON efc.family_id = f.id AND efc.is_primary = true
    LEFT JOIN contacts c ON c.id = efc.contact_id
    WHERE f.id = $1
  `, [context.id]);
  const row = result.rows[0];
  if (!row || (!row.website && !row.contactId)) return null;
  return {
    familyId: row.familyId,
    familyName: row.familyName,
    website: row.website ?? null,
    primaryContact: row.contactId ? {
      contactId: row.contactId,
      name: row.contactName,
      role: row.role ?? null,
      phone: row.phone ?? null,
      email: row.email ?? null,
    } : null,
  };
}
