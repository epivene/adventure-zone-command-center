import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
} from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookingOpportunities,
  bookingOpportunityQueueOverrides,
  bookings,
  followUps,
  organizations,
} from "@/db/schema";
import type {
  OpportunityPriority,
  OpportunityStatus,
} from "@/features/opportunities/opportunity-types";
import { businessDateKey, businessDayBounds } from "@/lib/business-date";
import {
  buildMasterTodayQueue,
  type MasterTodayQueue,
  type MasterWorkCandidate,
  type MasterWorkKind,
} from "./master-work-queue";

const closedOpportunityStatuses = [
  "not_pursuing",
  "declined",
  "no_response",
  "territory_hold",
  "cancelled",
] as const;

type DrizzleDatabase = typeof database;

type OpportunityProjection = {
  id: string;
  organizationId: string;
  eventYear: number;
  bookingId: string | null;
  contactId: string | null;
  status: OpportunityStatus;
  priority: OpportunityPriority;
  nextActionKind: string | null;
  nextActionDueAt: Date | null;
  organizationName: string | null;
  organizationCity: string | null;
  organizationRegion: string | null;
  bookingName: string | null;
  bookingCity: string | null;
  bookingRegion: string | null;
};

type FollowUpProjection = {
  id: string;
  bookingId: string | null;
  organizationId: string | null;
  contactId: string | null;
  kind: string;
  dueAt: Date;
  completedAt: Date | null;
  outcome: string | null;
  bookingName: string | null;
  bookingOrganizationId: string | null;
  bookingCity: string | null;
  bookingRegion: string | null;
};

type QueueOverrideProjection = {
  opportunityId: string;
  pinned: boolean;
  manualOrder: number | null;
  snoozedUntil: Date | null;
};

function kindFor(
  actionKind: string | null,
  status: OpportunityStatus | null,
  hasFollowUp: boolean,
): MasterWorkKind {
  const value = actionKind?.trim().toLowerCase().replaceAll("-", "_") ?? "";
  if (value.includes("reply") || value.includes("response")) return "reply";
  if (value.includes("callback") || value === "call" || value.includes("returned_call")) {
    return "callback";
  }
  if (value.includes("draft") || value.includes("ready_to_send")) return "draft";
  if (value.includes("research") || value.includes("scout")) return "research";
  if (value.includes("review") || value.includes("check")) return "review";
  if (value.includes("booking") || value.includes("contract")) return "booking";
  if (status === "ready_to_contact") return "draft";
  if (status === "new_lead") return "new_outreach";
  if (status === "researching") return "research";
  if (status === "needs_review") return "review";
  if (
    status === "interested" ||
    status === "booking_in_progress" ||
    status === "booked"
  ) {
    return "booking";
  }
  return hasFollowUp || value ? "follow_up" : "cleanup";
}

function reasonFor(kind: MasterWorkKind, completed: boolean): string {
  if (completed) return "Completed today";
  return {
    reply: "New reply needs attention",
    callback: "Call is due",
    follow_up: "Follow-up is due",
    draft: "Ready to Send",
    research: "Research is needed",
    review: "Needs review",
    new_outreach: "New outreach",
    booking: "Booking work",
    cleanup: "Profile cleanup",
  }[kind];
}

function chooseOpportunity(
  followUp: FollowUpProjection,
  byBooking: Map<string, OpportunityProjection>,
  byContact: Map<string, OpportunityProjection[]>,
  byOrganization: Map<string, OpportunityProjection[]>,
  currentYear: number,
): OpportunityProjection | null {
  if (followUp.bookingId) {
    const direct = byBooking.get(followUp.bookingId);
    if (direct) return direct;
  }
  const candidates = followUp.contactId
    ? byContact.get(followUp.contactId) ?? []
    : byOrganization.get(
        followUp.organizationId ?? followUp.bookingOrganizationId ?? "",
      ) ?? [];
  return (
    candidates.find(({ eventYear }) => eventYear === currentYear) ??
    [...candidates].sort((left, right) => right.eventYear - left.eventYear)[0] ??
    null
  );
}

function candidateFor(
  opportunity: OpportunityProjection | null,
  followUp: FollowUpProjection | null,
  override: QueueOverrideProjection | null,
  organizationName: string | null,
): MasterWorkCandidate {
  const actionKind = followUp?.kind ?? opportunity?.nextActionKind ?? null;
  const kind = kindFor(actionKind, opportunity?.status ?? null, followUp !== null);
  const completedAt = followUp?.completedAt ?? null;
  const sourceId = followUp?.id ?? opportunity?.id ?? "unlinked";
  return {
    id: `${followUp ? "follow_up" : "opportunity"}:${sourceId}`,
    sourceId,
    sourceType: followUp ? "follow_up" : "opportunity",
    opportunityId: opportunity?.id ?? null,
    organizationId:
      opportunity?.organizationId ??
      followUp?.organizationId ??
      followUp?.bookingOrganizationId ??
      null,
    bookingId: opportunity?.bookingId ?? followUp?.bookingId ?? null,
    contactId: opportunity?.contactId ?? followUp?.contactId ?? null,
    eventName:
      opportunity?.bookingName ??
      followUp?.bookingName ??
      opportunity?.organizationName ??
      organizationName ??
      "Booking work",
    city:
      opportunity?.bookingCity ??
      followUp?.bookingCity ??
      opportunity?.organizationCity ??
      null,
    region:
      opportunity?.bookingRegion ??
      followUp?.bookingRegion ??
      opportunity?.organizationRegion ??
      null,
    kind,
    reason: reasonFor(kind, completedAt !== null),
    dueAt: followUp?.dueAt ?? opportunity?.nextActionDueAt ?? null,
    opportunityStatus: opportunity?.status ?? null,
    priority: opportunity?.priority ?? "normal",
    pinned: override?.pinned ?? false,
    manualOrder: override?.manualOrder ?? null,
    completedAt,
    snoozedUntil: override?.snoozedUntil ?? null,
  };
}

export async function loadMasterTodayQueue(
  database: DrizzleDatabase,
  now: Date,
): Promise<MasterTodayQueue> {
  const currentYear = Number(businessDateKey(now).slice(0, 4));
  const businessDate = businessDateKey(now);
  const { start, end } = businessDayBounds(now);

  const opportunityRows: OpportunityProjection[] = await database
    .select({
      id: bookingOpportunities.id,
      organizationId: bookingOpportunities.organizationId,
      eventYear: bookingOpportunities.eventYear,
      bookingId: bookingOpportunities.bookingId,
      contactId: bookingOpportunities.contactId,
      status: bookingOpportunities.status,
      priority: bookingOpportunities.priority,
      nextActionKind: bookingOpportunities.nextActionKind,
      nextActionDueAt: bookingOpportunities.nextActionDueAt,
      organizationName: organizations.name,
      organizationCity: organizations.city,
      organizationRegion: organizations.region,
      bookingName: bookings.name,
      bookingCity: bookings.city,
      bookingRegion: bookings.region,
    })
    .from(bookingOpportunities)
    .leftJoin(organizations, eq(organizations.id, bookingOpportunities.organizationId))
    .leftJoin(bookings, eq(bookings.id, bookingOpportunities.bookingId))
    .where(notInArray(bookingOpportunities.status, closedOpportunityStatuses));

  const opportunityIds = opportunityRows.map(({ id }) => id);
  const overrideRows: QueueOverrideProjection[] = opportunityIds.length
    ? await database
        .select({
          opportunityId: bookingOpportunityQueueOverrides.opportunityId,
          pinned: bookingOpportunityQueueOverrides.pinned,
          manualOrder: bookingOpportunityQueueOverrides.manualOrder,
          snoozedUntil: bookingOpportunityQueueOverrides.snoozedUntil,
        })
        .from(bookingOpportunityQueueOverrides)
        .where(
          and(
            eq(bookingOpportunityQueueOverrides.businessDate, businessDate),
            inArray(bookingOpportunityQueueOverrides.opportunityId, opportunityIds),
          ),
        )
    : [];

  const followUpRows: FollowUpProjection[] = await database
    .select({
      id: followUps.id,
      bookingId: followUps.bookingId,
      organizationId: followUps.organizationId,
      contactId: followUps.contactId,
      kind: followUps.kind,
      dueAt: followUps.dueAt,
      completedAt: followUps.completedAt,
      outcome: followUps.outcome,
      bookingName: bookings.name,
      bookingOrganizationId: bookings.organizationId,
      bookingCity: bookings.city,
      bookingRegion: bookings.region,
    })
    .from(followUps)
    .leftJoin(bookings, eq(bookings.id, followUps.bookingId))
    .where(
      or(
        isNull(followUps.completedAt),
        and(gte(followUps.completedAt, start), lt(followUps.completedAt, end)),
      ),
    );

  const followUpOrganizationIds = [
    ...new Set(
      followUpRows.flatMap((row) => {
        const id = row.organizationId ?? row.bookingOrganizationId;
        return id ? [id] : [];
      }),
    ),
  ];
  const organizationRows = followUpOrganizationIds.length
    ? await database
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(inArray(organizations.id, followUpOrganizationIds))
    : [];
  const organizationNameById = new Map(
    organizationRows.map(({ id, name }) => [id, name]),
  );
  const overrideByOpportunity = new Map(
    overrideRows.map((row) => [row.opportunityId, row]),
  );
  const byBooking = new Map(
    opportunityRows.flatMap((row) => (row.bookingId ? [[row.bookingId, row] as const] : [])),
  );
  const byContact = new Map<string, OpportunityProjection[]>();
  const byOrganization = new Map<string, OpportunityProjection[]>();
  for (const opportunity of opportunityRows) {
    if (opportunity.contactId) {
      byContact.set(opportunity.contactId, [
        ...(byContact.get(opportunity.contactId) ?? []),
        opportunity,
      ]);
    }
    byOrganization.set(opportunity.organizationId, [
      ...(byOrganization.get(opportunity.organizationId) ?? []),
      opportunity,
    ]);
  }

  const matchedFollowUps = new Set<string>();
  const candidates: MasterWorkCandidate[] = [];
  for (const opportunity of opportunityRows) {
    const matching = followUpRows
      .filter(
        (followUp) =>
          chooseOpportunity(
            followUp,
            byBooking,
            byContact,
            byOrganization,
            currentYear,
          )?.id === opportunity.id,
      )
      .sort(
        (left, right) =>
          Number(left.completedAt !== null) - Number(right.completedAt !== null) ||
          left.dueAt.getTime() - right.dueAt.getTime(),
      );
    const open = matching.find(({ completedAt }) => completedAt === null) ?? null;
    if (open) matchedFollowUps.add(open.id);
    candidates.push(
      candidateFor(
        opportunity,
        open,
        overrideByOpportunity.get(opportunity.id) ?? null,
        opportunity.organizationName,
      ),
    );
    for (const completed of matching.filter(({ completedAt }) => completedAt !== null)) {
      matchedFollowUps.add(completed.id);
      candidates.push(
        candidateFor(
          opportunity,
          completed,
          overrideByOpportunity.get(opportunity.id) ?? null,
          opportunity.organizationName,
        ),
      );
    }
  }

  for (const followUp of followUpRows) {
    if (matchedFollowUps.has(followUp.id)) continue;
    const organizationId = followUp.organizationId ?? followUp.bookingOrganizationId;
    candidates.push(
      candidateFor(
        null,
        followUp,
        null,
        organizationId ? organizationNameById.get(organizationId) ?? null : null,
      ),
    );
  }

  return buildMasterTodayQueue(candidates, now);
}
