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

/** Existing protected-record rules are independent of ordinary content/intent approval.
 * An explicit territory exception is the only existing stored waiver. */
export async function outreachDispatchProtection(
  db: QueryDatabase,
  target: {
    organizationId: string;
    contactId?: string | null;
    recipientEmail?: string | null;
    opportunityId?: string | null;
    eventYear?: number | null;
    purpose?: string | null;
    templateCategory?: string | null;
  },
): Promise<string | null> {
  const block = await outreachContactBlock(db, target);
  if (block) return block;
  const result = await db.execute(sql`select g.last_resort,g.region,o.id,
    o.email_automation_protected,o.status,o.territory_exception_approved
    from organizations g left join booking_opportunities o on o.organization_id=g.id
      and (${target.opportunityId ?? null}::uuid is null or o.id=${target.opportunityId ?? null}::uuid)
      and (${target.eventYear ?? null}::integer is null or o.event_year=${target.eventYear ?? null}::integer)
    where g.id=${target.organizationId}::uuid`);
  const rows = (
    Array.isArray(result) ? result : (result as { rows: unknown[] }).rows
  ) as {
    last_resort: boolean;
    region: string | null;
    id: string | null;
    email_automation_protected: boolean;
    status: string | null;
    territory_exception_approved: boolean;
  }[];
  if (
    !rows.length ||
    (target.opportunityId && !rows.some((r) => r.id === target.opportunityId))
  )
    return "DO NOT SEND: Current profile or opportunity identity is missing.";
  for (const r of rows) {
    if (r.last_resort || r.email_automation_protected)
      return "DO NOT SEND: Protected record requires separate owner authorization; content approval does not waive protection.";
    if (["declined", "not_pursuing"].includes(r.status ?? ""))
      return "DO NOT SEND: Current event-year decline or not-pursuing outcome requires review.";
    const newOutreach =
      target.purpose === "new_outreach" ||
      target.templateCategory === "outreach" ||
      (!target.purpose && !target.templateCategory);
    if (
      !r.territory_exception_approved &&
      (r.status === "territory_hold" ||
        (newOutreach &&
          ["NM", "OR", "CA", "KS", "OK", "TX"].includes(
            r.region?.trim().toUpperCase() ?? "",
          )))
    )
      return "DO NOT SEND: Territory hold requires an explicitly approved territory exception.";
  }
  return null;
}
