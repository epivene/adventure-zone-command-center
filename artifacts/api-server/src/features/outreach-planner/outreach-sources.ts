import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { evaluateCapacity } from "./capacity-policy";
import type { SourcesDTO, OpeningDTO } from "./outreach-dto";
export type QueryDatabase = { execute(query: SQL): Promise<unknown> };
export function rowsOf<T>(value: unknown): T[] {
  return (Array.isArray(value) ? value : (value as { rows: T[] }).rows) ?? [];
}
export class OutreachSourceUnavailable extends Error {
  constructor(
    readonly sources: SourcesDTO,
    cause: unknown,
  ) {
    super("Source integration unavailable; retry the check.", { cause });
    sources.historyFingerprint = "unverified";
    sources.reviewReasons = [this.message];
    sources.capacity = {
      status: "needs_review",
      reasons: ["Capacity/calendar/travel sources are not verified."],
    };
  }
}
export async function readOutreachSources(
  db: QueryDatabase,
  opportunityId: string,
  opening: OpeningDTO,
  now: Date,
): Promise<SourcesDTO> {
  const result: SourcesDTO = {
    checkedAt: now.toISOString(),
    choices: [],
    historyFingerprint: "unverified",
    reviewReasons: [
      "Review inbound email and conversation history before generic cadence.",
    ],
    protectedReason: null,
    manualNextActions: [],
    capacity: evaluateCapacity({
      window: opening,
      legId: opening.legId,
      quantities: opening.quantities,
      capacities: {},
      reservations: [],
      evidenceVerified: false,
      travelVerified: false,
    }),
  };
  try {
    const [op] = rowsOf<{
      organization_id: string;
      contact_id: string | null;
      booking_id: string | null;
      event_year: number;
      last_resort: boolean;
      email_automation_protected: boolean;
      status: string;
      territory_exception_approved: boolean;
      next_action_kind: string | null;
      next_action_due_at: string | null;
    }>(
      await db.execute(
        sql`select o.*, g.last_resort from booking_opportunities o join organizations g on g.id=o.organization_id where o.id=${opportunityId}`,
      ),
    );
    if (!op) {
      result.protectedReason = "Opportunity no longer exists.";
      return result;
    }
    if (
      op.last_resort ||
      op.email_automation_protected ||
      (op.status === "territory_hold" && !op.territory_exception_approved)
    )
      result.protectedReason =
        "Protected contact or territory hold requires owner review.";
    if (op.next_action_due_at)
      result.manualNextActions.push({
        id: `opportunity:${opportunityId}`,
        kind: op.next_action_kind ?? "manual",
        dueAt: new Date(op.next_action_due_at).toISOString(),
      });
    const manual = rowsOf<{ id: string; kind: string; due_at: string }>(
      await db.execute(
        sql`select id,kind,due_at from follow_ups where completed_at is null and (organization_id=${op.organization_id} or booking_id=${op.booking_id} or contact_id=${op.contact_id})`,
      ),
    );
    result.manualNextActions.push(
      ...manual.map((v) => ({
        id: v.id,
        kind: v.kind,
        dueAt: new Date(v.due_at).toISOString(),
      })),
    );
    const emails = rowsOf<{
      gmail_message_id: string;
      sent_at: string;
      purpose: string;
    }>(
      await db.execute(
        sql`select gmail_message_id,sent_at,purpose from booking_opportunity_email_state where opportunity_id=${opportunityId} and event_year=${op.event_year} and state='sent' and sent_at is not null and nullif(trim(gmail_message_id),'') is not null`,
      ),
    );
    result.choices.push(
      ...emails.map((e) => ({
        id: `gmail:${e.gmail_message_id}`,
        kind: "sent_email" as const,
        occurredAt: new Date(e.sent_at).toISOString(),
        eligible: e.purpose !== "reply",
        reason:
          e.purpose === "reply"
            ? "Reply is not generic outreach."
            : "Verified successful send for this opportunity and event year.",
        purpose: e.purpose,
      })),
    );
    const calls = rowsOf<{
      id: string;
      ended_at: string;
      direction: string;
      disposition: string;
      booking_id: string | null;
    }>(
      await db.execute(
        sql`select id,ended_at,direction,disposition,booking_id from call_sessions where ended_at is not null and (organization_id=${op.organization_id} or booking_id=${op.booking_id} or contact_id=${op.contact_id})`,
      ),
    );
    result.choices.push(
      ...calls.map((c) => ({
        id: `call:${c.id}`,
        kind:
          c.direction === "incoming"
            ? ("incoming_call" as const)
            : ("outgoing_call" as const),
        requiresEventYearConfirmation:
          c.direction === "outgoing" &&
          ["no_answer", "left_voicemail"].includes(c.disposition) &&
          !c.booking_id,
        occurredAt: new Date(c.ended_at).toISOString(),
        eligible:
          c.direction === "outgoing" &&
          ["no_answer", "left_voicemail"].includes(c.disposition) &&
          !!op.booking_id &&
          c.booking_id === op.booking_id,
        reason:
          c.direction !== "outgoing"
            ? "Inbound call pauses generic outreach."
            : c.booking_id !== op.booking_id || !op.booking_id
              ? "Call has no explicit event-year booking match."
              : ["no_answer", "left_voicemail"].includes(c.disposition)
                ? "Completed outgoing attempt linked to event booking."
                : "Conversation or disposition requires review; not silent outreach.",
      })),
    );
    const interest = calls
      .filter(
        (c) =>
          c.booking_id === op.booking_id &&
          !!op.booking_id &&
          ["interested", "proposal_sent", "booked"].includes(c.disposition) &&
          new Date(c.ended_at) <= now,
      )
      .map((c) => new Date(c.ended_at).toISOString())
      .sort()
      .at(-1);
    if (interest) result.observedInterestAt = interest;
    const conversation = calls
      .filter(
        (c) =>
          c.booking_id === op.booking_id &&
          !!op.booking_id &&
          [
            "follow_up_needed",
            "spoke_with_contact",
            "email_requested",
          ].includes(c.disposition) &&
          new Date(c.ended_at) <= now,
      )
      .map((c) => new Date(c.ended_at).toISOString())
      .sort()
      .at(-1);
    if (conversation) result.observedConversationAt = conversation;
    if (calls.some((c) => !["incoming", "outgoing"].includes(c.direction)))
      result.protectedReason =
        "Logged call direction is unknown; correct the source before generic outreach.";
    const conventions = rowsOf<{ id: string; applied_at: string }>(
      await db.execute(
        sql`select id,applied_at from boss_convention_submissions where applied_at is not null and applied_organization_id=${op.organization_id} and (${op.contact_id}::uuid is null or applied_contact_id=${op.contact_id})`,
      ),
    );
    result.choices.push(
      ...conventions.map((c) => ({
        id: `convention:${c.id}`,
        kind: "convention" as const,
        occurredAt: new Date(c.applied_at).toISOString(),
        eligible: false,
        reason:
          "Explicit applied convention submission; convention end date must be separately verified.",
      })),
    );
    const packages = rowsOf<Record<string, unknown>>(
      await db.execute(
        sql`select id,code,normal_capacity,temporary_unavailable_quantity from package_templates`,
      ),
    );
    const bookings = rowsOf<Record<string, unknown>>(
      await db.execute(
        sql`select b.id, 'booking:' || b.id::text as canonical_id, b.starts_at,b.ends_at,b.status,b.probability,b.travel_leg_id,w.starts_at as custom_starts_at,w.ends_at as custom_exclusive_ends_at, coalesce((select jsonb_agg(p.code) from booking_package_selections s join package_templates p on p.id=s.package_template_id where s.booking_id=b.id),'[]'::jsonb) as selected_package_codes from bookings b left join booking_operational_windows w on w.booking_id=b.id where b.status <> 'cancelled'`,
      ),
    );
    const calendarMirrors = rowsOf<Record<string, unknown>>(
      await db.execute(
        sql`select id, 'booking:' || booking_id::text as canonical_id, calendar_id,google_event_id,package_key,reserved_starts_at,reserved_ends_at,last_synced_at,last_error_code from google_operational_calendar_links`,
      ),
    );
    const history = rowsOf<Record<string, unknown>>(
      await db.execute(
        sql`select id,updated_at,deleted_at from activities where (organization_id=${op.organization_id} or contact_id=${op.contact_id} or booking_id=${op.booking_id}) and not exists (select 1 from outreach_audit audit where audit.detail->>'profileActivityId'=activities.id::text) order by id`,
      ),
    );
    const emailMappings = rowsOf<Record<string, unknown>>(
      await db.execute(
        sql`select message_id,updated_at from google_workspace_validation_mappings where organization_id=${op.organization_id} order by message_id`,
      ),
    );
    result.historyFingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          result.choices.slice().sort((a, b) => a.id.localeCompare(b.id)),
          history,
          emailMappings,
        ]),
      )
      .digest("hex");
    result.capacityObservations = {
      bookings,
      calendarMirrors,
      packages,
      externalCalendarCoverage: "unverified",
      travel: "unverified",
    };
    result.capacity.reasons.push(
      "Booking package selections do not establish repeated-unit quantities; external calendar coverage and route travel are unverified.",
    );
    return result;
  } catch (error) {
    throw new OutreachSourceUnavailable(result, error);
  }
}
