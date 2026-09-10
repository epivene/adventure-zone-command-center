import { z } from "zod";
import { validCadence } from "./outreach-policy";
import { parseBusinessDate } from "../../lib/business-date";
import type {
  outreachOpenings,
  outreachCandidates,
  outreachAttempts,
  outreachResearchTasks,
} from "../../db/schema";
import type { OutreachDecision } from "./outreach-policy";
import type { CapacityDecision } from "./capacity-policy";
import type {
  AllocationTarget,
  AllocationFacts,
  HoldFact,
  DemandFact,
} from "./outreach-capacity-evidence";
const date = z
  .string()
  .refine((v) => !!parseBusinessDate(v), "Use a valid YYYY-MM-DD date");
const instant = z
  .string()
  .datetime({ offset: true })
  .refine((v) => !!parseBusinessDate(v.slice(0, 10)), "Invalid date");
export const openingInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    eventYear: z.number().int().min(2000).max(2200),
    startsOn: date,
    endsOn: date,
    legId: z.string().uuid().nullable(),
    quantities: z
      .record(z.string().min(1), z.number().int().positive())
      .refine((v) => Object.keys(v).length > 0),
  })
  .strict()
  .refine(
    (v) =>
      v.startsOn <= v.endsOn &&
      +v.startsOn.slice(0, 4) === v.eventYear &&
      +v.endsOn.slice(0, 4) === v.eventYear,
    "Window must be ordered and in the event year",
  );
export const candidateInput = z
  .object({
    openingId: z.string().uuid(),
    opportunityId: z.string().uuid(),
    tier: z
      .enum(["dedicated", "convention", "strong", "filler", "unclassified"])
      .default("unclassified"),
    manualRank: z.number().int().nonnegative().default(0),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();
export const cadenceInput = z
  .object({
    days: z.tuple([
      z.number().int().positive().max(3650),
      z.number().int().positive().max(3650),
      z.number().int().positive().max(3650),
    ]),
    minimumGapDays: z.number().int().positive().max(3650),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict()
  .refine(
    validCadence,
    "Days must strictly increase by at least the explicit minimum gap.",
  );
export const candidatePatch = z
  .object({
    tier: candidateInput.shape.tier.optional(),
    manualRank: candidateInput.shape.manualRank.optional(),
    snoozedUntil: instant.nullable().optional(),
    cadenceOverride: cadenceInput.nullable().optional(),
    decisionDueAt: instant.nullable().optional(),
    conventionEndsOn: date.nullable().optional(),
    meaningfulReplyAt: instant.nullable().optional(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();
export const attemptInput = z
  .object({
    sourceId: z.string().trim().min(1),
    stage: z.enum(["initial", "follow_up_1", "follow_up_2"]),
    confirmedEventYear: z.number().int().min(2000).max(2200).optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();
export const qualificationCriteriaInput = z
  .object({
    startsOn: date,
    endsOn: date,
    quantities: z
      .record(z.string().min(1), z.number().int().positive())
      .refine((v) => Object.keys(v).length > 0),
    geography: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        radiusMiles: z.number().positive().max(2000),
        adjacentRegions: z.array(z.string().trim().min(1)).max(50).default([]),
      })
      .strict(),
  })
  .strict()
  .refine((v) => v.startsOn <= v.endsOn, "Dates must be ordered.");
export const researchInput = z
  .object({
    criteria: z.string().trim().min(1).max(4000),
    qualificationCriteria: qualificationCriteriaInput,
    targetCount: z.number().int().min(1).max(100).default(3),
  })
  .strict();
export const researchResultInput = z
  .object({
    opportunityId: z.string().uuid(),
    sourceUrl: z
      .string()
      .url()
      .refine(
        (value) => ["https:", "http:"].includes(new URL(value).protocol),
        "Use an HTTP source URL.",
      ),
    note: z.string().trim().min(1).max(4000),
    checkedAt: instant,
    startsOn: date.optional(),
    endsOn: date.optional(),
    contact: z.string().trim().min(1).optional(),
    quantities: z
      .record(z.string().min(1), z.number().int().positive())
      .optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    region: z.string().trim().min(1).optional(),
    dateConfidence: z.enum(["verified", "unknown"]),
    contactConfidence: z.enum(["verified", "unknown"]),
    fitConfidence: z.enum(["verified", "unknown"]),
  })
  .strict();
export type ResearchResultInput = z.infer<typeof researchResultInput>;
export type ResearchInput = z.infer<typeof researchInput>;
export const profileAdmissionInput = z
  .object({
    organizationId: z.string().uuid(),
    eventYear: z.number().int().min(2000).max(2200),
    bookingId: z.string().uuid().nullable().optional(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();
export type ProfileAdmissionInput = z.infer<typeof profileAdmissionInput>;
export const opportunityBindingInput = z
  .object({
    bookingId: z.string().uuid(),
    confirmedEventYear: z.number().int().min(2000).max(2200),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();
export type OpportunityBindingInput = z.infer<typeof opportunityBindingInput>;
export type ProfileChoiceDTO = {
  organizationId: string;
  organizationName: string;
  city: string | null;
  region: string | null;
  protectedReason: string | null;
  suggestions: ClassificationSuggestionDTO[];
  bookings: {
    id: string;
    name: string;
    startsAt: string | null;
    endsAt: string | null;
  }[];
};
export type ClassificationSuggestionDTO = {
  tier: "filler" | "convention";
  reason: string;
  conventionYear?: number;
};
export type OpportunityChoiceDTO = {
  id: string;
  organizationId: string;
  bookingId: string | null;
  organizationName: string;
  eventYear: number;
  status: string;
  suggestions: ClassificationSuggestionDTO[];
  bookings: ProfileChoiceDTO["bookings"];
};
export type ProfileAdmissionDTO = {
  opportunityId: string;
  organizationId: string;
  bookingId: string | null;
  eventYear: number;
  reused: boolean;
  reason: string;
};
export type OpportunityBindingDTO = ProfileAdmissionDTO;
export type CandidateWaitingDTO = {
  candidateId: string;
  organizationName: string;
  openingId: string;
  openingTitle: string;
  reason: string;
};
export type PortfolioDecisionDTO = {
  state: "first_choice" | "waiting" | "needs_review" | "attention" | "inactive";
  reason: string;
  competing: CandidateWaitingDTO[];
};

export type OpeningInput = z.infer<typeof openingInput>;
export type CandidateInput = z.infer<typeof candidateInput>;
export type CandidatePatch = z.infer<typeof candidatePatch>;
export type AttemptInput = z.infer<typeof attemptInput>;
type JsonDates<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K];
};
export type OpeningDTO = JsonDates<typeof outreachOpenings.$inferSelect>;
export type ResearchTaskDTO = JsonDates<
  typeof outreachResearchTasks.$inferSelect
>;
export type SourceChoice = {
  id: string;
  kind: "sent_email" | "outgoing_call" | "incoming_call" | "convention";
  occurredAt: string;
  eligible: boolean;
  reason: string;
  purpose?: string;
  requiresEventYearConfirmation?: boolean;
  explicitStage?: "initial" | "follow_up_1" | "follow_up_2";
};
export type SourcesDTO = {
  checkedAt: string;
  choices: SourceChoice[];
  reviewReasons: string[];
  protectedReason: string | null;
  manualNextActions: { id: string; kind: string; dueAt: string }[];
  capacity: CapacityDecision;
  historyFingerprint: string;
  sourceReviews?: {
    sourceId: string;
    classification: "additional_attempt" | "not_cadence";
    occurredAt: string;
    reason: string;
  }[];
  pendingSourceReviewIds?: string[];
  inboundObservations?: {
    id: string;
    messageId: string;
    threadId: string;
    opportunityId: string | null;
    eventYear: number | null;
    receivedAt: string | null;
    state: string;
    classification: string | null;
    reviewedOpportunityId: string | null;
  }[];
  observedInterestAt?: string;
  observedConversationAt?: string;
  capacityObservations?: {
    bookingCount: number;
    calendarMirrorCount: number;
    packageCount: number;
    externalCalendarCoverage: "unverified";
    travel: "unverified";
  };
  allocationCheck?: AllocationCheckDTO;
};
export type CandidateDTO = JsonDates<typeof outreachCandidates.$inferSelect> & {
  organizationId: string;
  bookingId: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  suggestions: ClassificationSuggestionDTO[];
  waitingFor: CandidateWaitingDTO | null;
  portfolio: PortfolioDecisionDTO;
  organizationName: string;
  eventYear: number;
  opportunityStatus: string;
  attempts: JsonDates<typeof outreachAttempts.$inferSelect>[];
  outreach: OutreachDecision;
  capacity: CapacityDecision;
  capacityDisplayReasons: string[];
  sources: SourcesDTO;
  waitingForCandidateId: string | null;
  liveHoldId?: string | null;
  lastAllocationCheck?: AllocationCheckDTO & { freshness: "current" | "stale" };
};
export type PlannerDTO = {
  enabled: boolean;
  openings: OpeningDTO[];
  candidates: CandidateDTO[];
  researchTasks: ResearchTaskDTO[];
  legs: { id: string; name: string; active: boolean }[];
  packages: {
    id: string;
    code: string;
    name: string;
    active: boolean;
    normalCapacity: number;
    temporaryUnavailableQuantity: number;
  }[];
};

export const historyReviewInput = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict();

export const exactDemandInput = z
  .object({
    quantities: z
      .record(
        z.string().trim().min(1),
        z.number().int().positive().max(2147483647),
      )
      .refine((v) => Object.keys(v).length > 0),
    resourceIds: z
      .array(z.string().uuid())
      .min(1)
      .refine(
        (v) => new Set(v).size === v.length,
        "Each physical resource can be selected once.",
      ),
    completePhysicalDemandReviewed: z.literal(true),
    reason: z.string().trim().min(1).max(4000),
  })
  .strict();
export const holdExpiryInput = z.object({ expiresAt: instant }).strict();
export type AllocationCheckDTO = {
  capacity: CapacityDecision;
  checkedAt: string;
  bookingId: string | null;
  target: AllocationTarget | null;
  provenance: {
    calendarCheckedAt: string | null;
    calendarExpiresAt: string | null;
    calendarIds: string[];
    factsFingerprint: string | null;
    travelVerified: boolean;
    generation: number | null;
    calendarCoverage: { startsOn: string; endsOn: string } | null;
    calendarEventFingerprint: string | null;
    sourceErrors: string[];
  };
  allocationEnforcementComplete: boolean;
};
export type AllocationCatalogDTO = {
  holds: HoldFact[];
  demands: DemandFact[];
  resources: AllocationFacts["resources"];
  anchors?: AllocationFacts["anchors"];
  reconciliationFacts?: Record<string, unknown>[];
  allocationEnforcementComplete: boolean;
};

export type RecoveryCatalogDTO = {
  bookings: {
    id: string;
    organizationId: string | null;
    organizationName: string | null;
    name: string;
    startsAt: string | null;
    endsAt: string | null;
    status: string;
    travelLegId: string | null;
  }[];
  drafts: {
    id: string;
    kind: "opportunity_email" | "office_email";
    organizationId: string;
    opportunityId: string | null;
    bookingId: string | null;
    eventYear: number | null;
    subject: string | null;
    recipientEmail: string | null;
    state: string;
  }[];
};
export type SourceReviewDTO = NonNullable<SourcesDTO["sourceReviews"]>[number];
export type InboundObservationDTO = NonNullable<
  SourcesDTO["inboundObservations"]
>[number];
