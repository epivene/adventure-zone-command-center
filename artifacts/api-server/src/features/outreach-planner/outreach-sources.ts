import { outreachContactBlock } from "./outreach-contact-safety";
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
    result.protectedReason =
      (await outreachContactBlock(db, {
        organizationId: op.organization_id,
        contactId: op.contact_id,
      })) ?? result.protectedReason;
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
    const sentReply = emails
      .filter((e) => e.purpose === "reply" && new Date(e.sent_at) <= now)
      .map((e) => new Date(e.sent_at).toISOString())
      .sort()
      .at(-1);
    if (sentReply) result.observedConversationAt = sentReply;
    if (process.env.OUTREACH_PLANNER_ENABLED === "true") {
      const inbound = rowsOf<any>(
        await db.execute(
          sql`select id,message_id,thread_id,opportunity_id,event_year,received_at,state,classification,reviewed_opportunity_id from outreach_inbound_observations where organization_id=${op.organization_id}::uuid and (opportunity_id is null or opportunity_id=${opportunityId}::uuid) order by received_at`,
        ),
      );
      result.inboundObservations = inbound.map((row) => ({
        id: row.id,
        messageId: row.message_id,
        threadId: row.thread_id,
        opportunityId: row.opportunity_id,
        eventYear: row.event_year,
        receivedAt: row.received_at
          ? new Date(row.received_at).toISOString()
          : null,
        state: row.state,
        classification: row.classification,
        reviewedOpportunityId: row.reviewed_opportunity_id,
      }));
      if (inbound.some((m) => m.state === "needs_review"))
        result.protectedReason =
          "Received email needs owner reply, conversation or non-reply classification; event year may need review.";
      const reply = inbound
        .filter(
          (m) =>
            m.state === "reviewed" &&
            m.classification === "meaningful_reply" &&
            m.reviewed_opportunity_id === opportunityId &&
            m.received_at,
        )
        .at(-1);
      if (reply)
        result.observedInterestAt = new Date(reply.received_at).toISOString();
      const conversation = inbound
        .filter(
          (m) =>
            m.state === "reviewed" &&
            m.classification === "conversation" &&
            m.reviewed_opportunity_id === opportunityId &&
            m.received_at,
        )
        .at(-1);
      if (conversation)
        result.observedConversationAt = new Date(
          conversation.received_at,
        ).toISOString();
      const approved = rowsOf<{
        message_id: string;
        stage: "initial" | "follow_up_1" | "follow_up_2" | null;
        intent: string;
      }>(
        await db.execute(
          sql`select confirmation->>'messageId' as message_id,stage,intent from outreach_dispatches where state='sent' and payload->>'opportunityId'=${opportunityId} and (payload->>'eventYear')::integer=${op.event_year} and draft_kind='opportunity_email'`,
        ),
      );
      for (const source of result.choices) {
        const dispatch = approved.find(
          (a) => source.id === `gmail:${a.message_id}`,
        );
        if (dispatch?.stage) source.explicitStage = dispatch.stage;
        if (dispatch?.intent === "administrative") {
          source.eligible = false;
          source.requiresEventYearConfirmation = false;
          source.reason =
            "Explicitly administrative email is not cadence outreach.";
        }
      }
      const office = rowsOf<{
        id: string;
        sent_message_id: string;
        sent_at: string;
        event_year: number | null;
        booking_id: string | null;
        stage: "initial" | "follow_up_1" | "follow_up_2" | null;
        intent: string | null;
      }>(
        await db.execute(
          sql`select d.id,d.sent_message_id,d.sent_at,d.event_year,d.booking_id,x.stage,x.intent from office_email_drafts d left join outreach_dispatches x on x.draft_kind='office_email' and x.draft_id=d.id and x.state='sent' where d.organization_id=${op.organization_id}::uuid and d.state='sent' and d.sent_at is not null and nullif(trim(d.sent_message_id),'') is not null and (d.event_year=${op.event_year} or d.event_year is null)`,
        ),
      );
      result.choices.push(
        ...office.map((e) => ({
          id: `office-email:${e.id}:${e.sent_message_id}`,
          kind: "sent_email" as const,
          occurredAt: new Date(e.sent_at).toISOString(),
          requiresEventYearConfirmation:
            e.event_year === null && e.intent !== "administrative",
          eligible:
            e.event_year === op.event_year &&
            (!e.booking_id || e.booking_id === op.booking_id) &&
            e.intent !== "administrative",
          ...(e.stage ? { explicitStage: e.stage } : {}),
          reason:
            e.event_year === null
              ? "Office send needs explicit event-year review."
              : e.intent === "administrative"
                ? "Administrative email is not generic outreach."
                : "Actual Office send; link the reviewed stage for this event year.",
        })),
      );
    }
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
          (c.direction === "incoming" ||
            (c.booking_id === op.booking_id && !!op.booking_id)) &&
          (c.direction === "incoming" ||
            [
              "follow_up_needed",
              "spoke_with_contact",
              "email_requested",
            ].includes(c.disposition)) &&
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
    const [counts] = rowsOf<{
      booking_count: number;
      calendar_mirror_count: number;
      package_count: number;
    }>(
      await db.execute(
        sql`select (select count(*) from bookings where status <> 'cancelled') as booking_count, (select count(*) from google_operational_calendar_links) as calendar_mirror_count, (select count(*) from package_templates) as package_count`,
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
          result.inboundObservations ?? [],
        ]),
      )
      .digest("hex");
    result.capacityObservations = {
      bookingCount: Number(counts.booking_count),
      calendarMirrorCount: Number(counts.calendar_mirror_count),
      packageCount: Number(counts.package_count),
      externalCalendarCoverage: "unverified",
      travel: "unverified",
    };
    result.capacity.reasons.push(
      "Run the fresh allocation check to verify exact package/physical demand, Calendar coverage and route travel.",
    );
    return result;
  } catch (error) {
    throw new OutreachSourceUnavailable(result, error);
  }
}
