import { z } from "zod";
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
export const candidatePatch = z
  .object({
    tier: candidateInput.shape.tier.optional(),
    manualRank: candidateInput.shape.manualRank.optional(),
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
export const researchInput = z
  .object({ criteria: z.string().trim().min(1).max(4000) })
  .strict();
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
export type SourceChoice = {
  id: string;
  kind: "sent_email" | "outgoing_call" | "incoming_call" | "convention";
  occurredAt: string;
  eligible: boolean;
  reason: string;
  purpose?: string;
  requiresEventYearConfirmation?: boolean;
};
export type SourcesDTO = {
  checkedAt: string;
  choices: SourceChoice[];
  reviewReasons: string[];
  protectedReason: string | null;
  manualNextActions: { id: string; kind: string; dueAt: string }[];
  capacity: CapacityDecision;
  historyFingerprint: string;
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
  organizationName: string;
  eventYear: number;
  opportunityStatus: string;
  attempts: JsonDates<typeof outreachAttempts.$inferSelect>[];
  outreach: OutreachDecision;
  capacity: CapacityDecision;
  sources: SourcesDTO;
  waitingForCandidateId: string | null;
  liveHoldId?: string | null;
  lastAllocationCheck?: AllocationCheckDTO & { freshness: "current" | "stale" };
};
export type PlannerDTO = {
  enabled: boolean;
  openings: OpeningDTO[];
  candidates: CandidateDTO[];
  researchTasks: JsonDates<typeof outreachResearchTasks.$inferSelect>[];
  legs: { id: string; name: string }[];
  packages: {
    id: string;
    code: string;
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
  allocationEnforcementComplete: false;
};
export type AllocationCatalogDTO = {
  holds: HoldFact[];
  demands: DemandFact[];
  resources: AllocationFacts["resources"];
  allocationEnforcementComplete: false;
};
