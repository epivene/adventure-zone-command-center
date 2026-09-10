import { sql } from "drizzle-orm";
import type { QueryDatabase } from "./outreach-sources";
import { normalizeCommunicationBlockEmail } from "../lead-intake/communication-block-policy";

/** Customer sends only: preview and import-row blocks have deliberately narrower scope. */
export async function outreachContactBlock(
  db: QueryDatabase,
  target: {
    organizationId: string;
    contactId?: string | null;
    recipientEmail?: string | null;
  },
): Promise<string | null> {
  const email = normalizeCommunicationBlockEmail(target.recipientEmail);
  const result =
    await db.execute(sql`select b.reason from communication_blocks b where b.active=true and (
    (b.target_type='organization' and b.organization_id=${target.organizationId}::uuid)
    or (b.target_type='contact' and b.contact_id=${target.contactId ?? null}::uuid)
    or (b.target_type='recipient_email' and lower(trim(b.normalized_email))=${email} and ${email}<>'')
    or (b.target_type='recipient_email' and ${email}='' and exists(select 1 from contacts c where c.id=${target.contactId ?? null}::uuid and lower(trim(c.email))=lower(trim(b.normalized_email))))
  ) order by b.id limit 1`);
  const rows = (
    Array.isArray(result)
      ? result
      : (result as { rows: { reason: string }[] }).rows
  ) as { reason: string }[];
  return rows[0] ? `DO NOT SEND: ${rows[0].reason}` : null;
}
