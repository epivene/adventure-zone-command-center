import { randomUUID } from "node:crypto";
import { z } from "zod";
import { activeConnection, ConnectionError, inputHash, requireConnectionScope, type ConnectionDatabase, type ConnectionPrincipal, type MutationKey, type SqlQuery } from "./contracts";
import { OperationStore } from "./operation-store";

export const inquiryProcessInput = z.object({
  inquiryId: z.string().uuid(),
  action: z.enum(["begin_review", "link_existing"]),
  profileId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
}).strict();
export const inquiryProcessApplyInput = inquiryProcessInput.extend({
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(10).max(2000),
});
type Input = z.infer<typeof inquiryProcessInput>;

/** Connector-only review/link operations. Never creates bookings, contacts or reminders. */
export class WebsiteInquiryProcessing {
  private operations: OperationStore;
  constructor(private db: ConnectionDatabase, private appOrigin: string) {
    this.operations = new OperationStore(db);
  }
  private async snapshot(tx: SqlQuery, input: Input, lock = false) {
    const ids = [input.profileId, input.contactId, input.bookingId];
    if ((input.action === "link_existing" && ids.some(id => !id)) ||
        (input.action === "begin_review" && ids.some(Boolean)))
      throw new ConnectionError("WEBSITE_INQUIRY_INPUT_INVALID", 400);
    const inquiry = (await tx.query(
      "SELECT id,status,reference_code,name,email,event_name,event_date::text,message,converted_contact_id,converted_organization_id,converted_booking_id,updated_at::text AS revision FROM website_inquiries WHERE id=$1" + (lock ? " FOR UPDATE" : ""),
      [input.inquiryId])).rows[0];
    if (!inquiry) throw new ConnectionError("WEBSITE_INQUIRY_NOT_FOUND", 404);
    if (!["new", "reviewing"].includes(inquiry.status))
      throw new ConnectionError("WEBSITE_INQUIRY_STATUS_CONFLICT", 409);
    if (inquiry.converted_contact_id || inquiry.converted_organization_id || inquiry.converted_booking_id)
      throw new ConnectionError("WEBSITE_INQUIRY_LINK_CONFLICT", 409);
    if (input.action === "begin_review") return { inquiry, selection: null };
    const suffix = lock ? " FOR SHARE" : "";
    const profile = (await tx.query("SELECT id,name,city,region,consolidated_into_id,updated_at::text AS revision FROM organizations WHERE id=$1" + suffix,[input.profileId])).rows[0];
    const contact = (await tx.query("SELECT id,first_name,last_name,email,updated_at::text AS revision FROM contacts WHERE id=$1" + suffix,[input.contactId])).rows[0];
    const booking = (await tx.query("SELECT id,organization_id,name,starts_at::text,ends_at::text,status,updated_at::text AS revision FROM bookings WHERE id=$1" + suffix,[input.bookingId])).rows[0];
    if (!profile || profile.consolidated_into_id || !contact || !booking || booking.organization_id !== profile.id)
      throw new ConnectionError("WEBSITE_INQUIRY_MATCH_CONFLICT", 409);
    const membership = (await tx.query("SELECT organization_id,contact_id,active FROM organization_contacts WHERE organization_id=$1 AND contact_id=$2 AND active=true" + suffix,[profile.id,contact.id])).rows;
    const bookingContact = (await tx.query("SELECT booking_id,contact_id FROM booking_contacts WHERE booking_id=$1 AND contact_id=$2" + suffix,[booking.id,contact.id])).rows;
    if (!membership.length || !bookingContact.length ||
        !contact.email || contact.email.trim().toLowerCase() !== inquiry.email.trim().toLowerCase())
      throw new ConnectionError("WEBSITE_INQUIRY_MATCH_CONFLICT", 409);
    return { inquiry, selection: { profile, contact, booking, membership, bookingContact } };
  }
  async preview(p: ConnectionPrincipal, raw: Input) {
    requireConnectionScope(p, "crm:read");
    await activeConnection(this.db, p);
    const input = inquiryProcessInput.parse(raw);
    const snapshot = await this.snapshot(this.db, input);
    return { ...snapshot, expectedRevision: inputHash({ input, snapshot }),
      instruction: "Read the full inquiry and profile/history. Verify event and year, not only matching email. Search duplicate profiles before selecting existing records. This links only the specified existing profile/contact/booking; no records, follow-ups, dates, promises or email are created. If no exact existing match is verified, leave reviewing and use the app conversion workflow." };
  }
  async apply(p: ConnectionPrincipal, key: MutationKey, raw: z.infer<typeof inquiryProcessApplyInput>) {
    requireConnectionScope(p, "crm:read");
    requireConnectionScope(p, "crm:update");
    const { expectedRevision, reason, ...input } = inquiryProcessApplyInput.parse(raw);
    return this.operations.perform(p, "process_website_inquiry", key, { ...input, expectedRevision, reason }, async tx => {
      const snapshot = await this.snapshot(tx, input, true);
      if (inputHash({ input, snapshot }) !== expectedRevision)
        throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
      const linked = input.action === "link_existing";
      const row = (await tx.query(
        `UPDATE website_inquiries SET status=$2,reviewed_by_kind='owner',reviewed_by_id=$3,
         reviewed_by_name='Owner-authorized connector',reviewed_at=coalesce(reviewed_at,now()),
         converted_organization_id=$4,converted_contact_id=$5,converted_booking_id=$6,
         converted_at=CASE WHEN $2='converted' THEN now() ELSE NULL END,updated_at=now()
         WHERE id=$1 RETURNING id,status,converted_organization_id,converted_contact_id,converted_booking_id,updated_at::text AS revision`,
        [input.inquiryId,linked ? "converted" : "reviewing",p.ownerId,input.profileId ?? null,input.contactId ?? null,input.bookingId ?? null])).rows[0];
      await tx.query(
        'INSERT INTO audit_entries(entity_type,entity_id,action,"before","after") VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',
        ["website_inquiry",input.inquiryId,input.action,JSON.stringify(snapshot.inquiry),
         JSON.stringify({ ...row, reason, actor: { kind: "owner", id: p.ownerId, connectionId: p.connectionId }, createdRecords: false })]);
      return { operationId: randomUUID(), recordId: row.id,
        href: new URL("/website-inquiries?inquiry=" + row.id,this.appOrigin).href,
        revision: row.revision, savedAt: new Date(row.revision).toISOString(),
        value: { ...row, createdRecords: false, sent: false } };
    });
  }
}
