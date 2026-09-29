import { createHash } from "node:crypto";
import type { Evidence, Queryable, RunContext } from "./contracts";

export function serializeProfileBrief(input: {
  identity: string;
  primaryContact: string;
  nextFollowUp: string | null;
  recentActivity: string[];
}): string {
  const header =
    "Partial profile brief. More notes, bookings and emails are omitted; retrieve originals when needed.\n";
  const text =
    header +
    `Profile: ${input.identity.slice(0, 700)}\nPrimary contact: ${input.primaryContact.slice(0, 700)}\nNext follow-up: ${(input.nextFollowUp ?? "None recorded").slice(0, 500)}\nRecent activity:\n${input.recentActivity.slice(0, 3).join("\n")}`;
  return text.length <= 4000
    ? text
    : text.slice(0, 3960) + "\n[Additional content omitted]";
}
export async function loadProfileBrief(
  db: Queryable,
  context: RunContext,
): Promise<Evidence[]> {
  if (context.selection.organizationIds.length !== 1) return [];
  if (context.actor.role !== "owner")
    throw new Error("ASSISTANT_ACCESS_DENIED");
  const id = context.selection.organizationIds[0];
  const profile = await db.query(
    "SELECT id,name,city,region,updated_at FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL",
    [id],
  );
  if (!profile.rows[0]) throw new Error("ASSISTANT_PROFILE_NOT_FOUND");
  const [contact, followUp, activities] = await Promise.all([
    db.query(
      "SELECT c.id,c.first_name,c.last_name,c.email,c.phone FROM contacts c JOIN organization_contacts oc ON oc.contact_id=c.id WHERE oc.organization_id=$1 AND oc.active=true ORDER BY oc.is_primary DESC,c.id LIMIT 1",
      [id],
    ),
    db.query(
      "SELECT id,kind,due_at FROM follow_ups WHERE organization_id=$1 AND completed_at IS NULL ORDER BY due_at,id LIMIT 1",
      [id],
    ),
    db.query(
      "SELECT id,kind,left(body,800) AS body,occurred_at FROM activities WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY timeline_sort_at DESC,id LIMIT 3",
      [id],
    ),
  ]);
  const p = profile.rows[0],
    c = contact.rows[0];
  const text = serializeProfileBrief({
    identity: JSON.stringify(p),
    primaryContact: c ? JSON.stringify(c) : "Not recorded",
    nextFollowUp: followUp.rows[0] ? JSON.stringify(followUp.rows[0]) : null,
    recentActivity: activities.rows.map((row) => JSON.stringify(row)),
  });
  const version = createHash("sha256").update(text).digest("hex");
  return [
    {
      id: `profile-brief:${id}`,
      kind: "profile",
      recordId: id,
      eventYear: context.selection.eventYear,
      occurredAt: null,
      retrievedAt: new Date().toISOString(),
      version,
      complete: false,
      text,
    },
  ];
}
