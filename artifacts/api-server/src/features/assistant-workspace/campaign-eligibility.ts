import { z } from "zod";
import { outreachDispatchProtection } from "../outreach-planner/outreach-contact-safety";
import { fingerprint } from "./action-store";
import type { Queryable } from "./contracts";
import type { CampaignBatch, CampaignMember } from "./campaign-store";
export async function reviewCampaignMember(
  database: any,
  q: Queryable,
  batch: CampaignBatch,
  member: CampaignMember,
  options: { ignoreDraftId?: string } = {},
) {
  const reasons: string[] = [],
    cautions: string[] = [];
  if (
    !Number.isInteger(batch.eventYear) ||
    batch.eventYear < 2000 ||
    batch.eventYear > 2200
  )
    reasons.push("EVENT_YEAR_REQUIRED");
  const profile = (
    await q.query(
      "SELECT id,name FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL",
      [member.organizationId],
    )
  ).rows[0];
  if (!profile) reasons.push("PROFILE_NOT_ACTIVE");
  const contact = (
    await q.query(
      "SELECT c.id,lower(trim(c.email)) AS email FROM contacts c JOIN organization_contacts oc ON oc.contact_id=c.id WHERE c.id=$1 AND oc.organization_id=$2 AND oc.active=true",
      [member.contactId, member.organizationId],
    )
  ).rows[0];
  const email = contact?.email ?? null;
  if (!contact || !z.email().safeParse(email).success)
    reasons.push("CONTACT_NOT_ACTIVE");
  if (email) {
    const duplicates = (
      await q.query(
        "SELECT c.id,oc.organization_id FROM contacts c JOIN organization_contacts oc ON oc.contact_id=c.id WHERE c.id=ANY($1::uuid[]) AND oc.active=true AND lower(trim(c.email))=$2",
        [batch.members.map((m) => m.contactId).filter(Boolean), email],
      )
    ).rows.filter((r: any) =>
      batch.members.some(
        (m) => m.contactId === r.id && m.organizationId === r.organization_id,
      ),
    );
    if (new Set(duplicates.map((r: any) => r.organization_id)).size > 1)
      reasons.push("DUPLICATE_BATCH_RECIPIENT");
  }
  if (member.bookingId) {
    const booking = (
      await q.query(
        "SELECT b.id,(SELECT CASE WHEN count(DISTINCT o.event_year)=1 THEN min(o.event_year) END FROM booking_opportunities o WHERE o.booking_id=b.id AND o.organization_id=b.organization_id) AS event_year FROM bookings b WHERE b.id=$1 AND b.organization_id=$2",
        [member.bookingId, member.organizationId],
      )
    ).rows[0];
    if (!booking || booking.event_year !== batch.eventYear)
      reasons.push("BOOKING_EVENT_YEAR_MISMATCH");
  } else
    cautions.push(
      "Planning year selected; event dates and availability are not confirmed.",
    );
  if (profile) {
    const protection = await outreachDispatchProtection(database, {
      ...member,
      recipientEmail: email,
      eventYear: batch.eventYear,
      purpose: "new_outreach",
    });
    if (protection) reasons.push(protection);
  }
  const blockedRecords = (
    await q.query(
      `SELECT id,'workspace_draft' AS kind,status AS state,(content->>'eventYear')::integer AS "eventYear" FROM assistant_workspace_drafts WHERE (id IS DISTINCT FROM $4::uuid OR status IN ('sending','uncertain','sent')) AND (content->>'organizationId'=$1 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(content->'to') e WHERE lower(trim(e))=$2)) AND (content->>'eventYear' IS NULL OR content->>'eventYear'=$3::text)
 UNION ALL SELECT d.id,'office_draft',CASE WHEN x.state IN ('dispatching','uncertain','sent') THEN x.state ELSE d.state END,d.event_year FROM office_email_drafts d LEFT JOIN outreach_dispatches x ON x.draft_kind='office_email' AND x.draft_id=d.id WHERE (d.id IS DISTINCT FROM $4::uuid OR d.state IN ('sending','sent') OR x.state IN ('dispatching','uncertain','sent')) AND (d.organization_id=$1::uuid OR lower(trim(d.recipient_email))=$2) AND (d.event_year=$3::integer OR d.event_year IS NULL) AND (d.state NOT IN ('cancelled','failed') OR x.state IN ('dispatching','uncertain','sent'))
 UNION ALL SELECT d.id,'opportunity_email',CASE WHEN x.state IN ('dispatching','uncertain','sent') THEN x.state ELSE d.state END,d.event_year FROM booking_opportunity_email_state d LEFT JOIN outreach_dispatches x ON x.draft_kind='opportunity_email' AND x.draft_id=d.id WHERE (d.organization_id=$1::uuid OR lower(trim(d.recipient_email))=$2) AND (d.event_year=$3::integer OR d.event_year IS NULL) AND (d.state NOT IN ('cancelled','failed') OR x.state IN ('dispatching','uncertain','sent')) LIMIT 101`,
      [
        member.organizationId,
        email,
        batch.eventYear,
        options.ignoreDraftId ?? null,
      ],
    )
  ).rows;
  if (blockedRecords.length) reasons.push("EXISTING_OUTREACH_REQUIRES_REVIEW");
  if (blockedRecords.some((r) => r.eventYear === null))
    cautions.push("Existing outreach has no verified event year.");
  const openFollowups = (
    await q.query(
      'SELECT id,kind,due_at AS "dueAt",contact_id AS "contactId",booking_id AS "bookingId" FROM follow_ups WHERE organization_id=$1 AND completed_at IS NULL ORDER BY due_at LIMIT 101',
      [member.organizationId],
    )
  ).rows;
  if (openFollowups.length)
    cautions.push(
      "Existing follow-ups are preserved; review their dates before scheduling more.",
    );
  const facts = {
    member,
    email,
    eventYear: batch.eventYear,
    reasons,
    cautions,
    blockedRecords,
    openFollowups,
  };
  return {
    eligible: reasons.length === 0,
    ...facts,
    profileName: profile?.name ?? null,
    checkedAt: new Date().toISOString(),
    fingerprint: fingerprint(facts),
    truncated: blockedRecords.length > 100 || openFollowups.length > 100,
  };
}
