import { z } from "zod";
import { operationsSourceSchema } from "./operations-source";

const id = z.string().uuid();
const text = z.string().trim().min(1).max(2000);
const revision = z.number().int().positive();
export type PlanningActor =
  | { kind: "owner"; subject: string }
  | { kind: "boss"; accountId: string; sessionVersion: number }
  | { kind: "manager"; legId: string; sessionVersion: number };
export const windowInputSchema = z
  .object({
    startsAt: z.string().nullable(),
    endsAt: z.string().nullable(),
    semantics: z.enum(["timestamp", "inclusive_date", "exclusive_date"]),
    source: text,
  })
  .strict();
export type WindowInput = z.infer<typeof windowInputSchema>;
export type OperationalWindow = {
  startMs: number;
  endMs: number;
  source: string;
};
export type WindowResult =
  | { state: "resolved"; window: OperationalWindow }
  | { state: "needs_review"; reasons: string[] };
export const planRequirementsSchema = z
  .object({
    minimumCrew: z.number().int().nonnegative().nullable(),
    roles: z.record(z.string(), z.number().int().nonnegative()).nullable(),
    transportRequired: z.boolean().nullable(),
    lodging: z.enum(["unknown", "required", "unnecessary"]),
    lodgingReason: text.nullable(),
  })
  .strict();
export type PlanRequirements = z.infer<typeof planRequirementsSchema>;
export const crewAssignmentSchema = z
  .object({
    workerId: id,
    role: text,
    window: windowInputSchema,
    state: z.enum(["proposed", "confirmed"]),
  })
  .strict();
export const lodgingEntrySchema = z
  .object({
    id: id,
    description: text,
    location: text,
    capacity: z.number().int().positive(),
    window: windowInputSchema,
    source: operationsSourceSchema,
  })
  .strict();
export const planDraftSchema = z
  .object({
    bookingId: id,
    legId: id,
    seasonYear: z.number().int().min(1900).max(9998),
    window: windowInputSchema.nullable(),
    phases: z
      .object({
        arrival: windowInputSchema.optional(),
        setup: windowInputSchema.optional(),
        operating: windowInputSchema.optional(),
        teardown: windowInputSchema.optional(),
        departure: windowInputSchema.optional(),
      })
      .strict(),
    requirements: planRequirementsSchema,
    crew: z.array(crewAssignmentSchema).max(100),
    packageSetIds: z.array(id).max(20),
    transportResourceIds: z.array(id).max(20),
    lodging: z.array(lodgingEntrySchema).max(20),
    splitGroupId: id.nullable(),
    loadInAddress: text.nullable().optional(),
    travelReview: z
      .object({
        endpointFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        source: operationsSourceSchema,
        reviewedAt: z.string().datetime().optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    for (const [field, values] of [
      ["crew", p.crew.map((c) => c.workerId)],
      ["packageSetIds", p.packageSetIds],
      ["transportResourceIds", p.transportResourceIds],
    ] as const)
      if (new Set(values).size !== values.length)
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Choose each worker or item once.",
        });
  });
export type PlanDraft = z.infer<typeof planDraftSchema>;
export const eventPlanSchema = z.object({
  bookingId: id,
  revision,
  draft: planDraftSchema,
  committed: planDraftSchema.nullable(),
  invalidationReasons: z.array(z.string()),
});
export type EventPlan = z.infer<typeof eventPlanSchema>;
export const legSeasonPlanInputSchema = z
  .object({
    legId: id,
    seasonYear: z.number().int().min(1900).max(9998),
    leadership: z.enum(["confirmed", "tentative", "unfilled"]),
    managerWorkerId: id.nullable(),
    managerName: text.nullable(),
    workerIds: z.array(id),
    baseAddress: text.nullable(),
    transportResourceIds: z.array(id),
  })
  .strict();
export const legSeasonPlanSchema = legSeasonPlanInputSchema.extend({
  revision,
});
export type LegSeasonPlanInput = z.infer<typeof legSeasonPlanInputSchema>;
export type LegSeasonPlan = z.infer<typeof legSeasonPlanSchema>;
export const crewAvailabilityInputSchema = z
  .object({
    id: id.nullable(),
    workerId: id,
    window: windowInputSchema,
    state: z.enum(["confirmed", "unavailable", "unverified"]),
    source: operationsSourceSchema,
  })
  .strict();
export const crewAvailabilitySchema = crewAvailabilityInputSchema.extend({
  id,
  revision,
});
export type CrewAvailabilityInput = z.infer<typeof crewAvailabilityInputSchema>;
export type CrewAvailability = z.infer<typeof crewAvailabilitySchema>;
export const packageSetInputSchema = z
  .object({
    id: id.nullable(),
    packageId: id,
    name: text,
    classification: z.enum(["normal", "extra"]),
    resourceIds: z.array(id).max(100),
    requirements: z.record(z.string(), z.number().int().positive()),
    verify: z.boolean(),
    source: operationsSourceSchema.nullable(),
  })
  .strict();
export const packageSetSchema = packageSetInputSchema
  .omit({ verify: true })
  .extend({
    id,
    revision,
    state: z.enum(["unverified", "verified"]),
    verifiedBy: z.string().nullable(),
    verifiedAt: z.string().nullable(),
  });
export type PackageSetInput = z.infer<typeof packageSetInputSchema>;
export type PackageSet = z.infer<typeof packageSetSchema>;
export const splitGroupInputSchema = z
  .object({ id: id.nullable(), parentLegId: id, bookingIds: z.tuple([id, id]) })
  .strict()
  .refine(
    (s) => s.bookingIds[0] !== s.bookingIds[1],
    "Choose two different bookings.",
  );
export const splitGroupSchema = z.object({
  id,
  parentLegId: id,
  bookingIds: z.tuple([id, id]),
  revision,
});
export type SplitGroupInput = z.infer<typeof splitGroupInputSchema>;
export type SplitGroup = z.infer<typeof splitGroupSchema>;
export const daveAuthorityInputSchema = z
  .object({ accountId: id.nullable() })
  .strict();
export const daveAuthoritySchema = daveAuthorityInputSchema.extend({
  revision,
});
export type DaveAuthorityInput = z.infer<typeof daveAuthorityInputSchema>;
export type DaveAuthority = z.infer<typeof daveAuthoritySchema>;
export const approvalRequestSchema = z.object({
  id,
  type: z.enum(["split", "extra_adventure_zone", "extra_pirates"]),
  bookingIds: z.array(id).min(1).max(20),
  parentLegId: id,
  planFingerprint: text,
  state: z.enum(["pending", "decided"]),
  revision,
  createdAt: z.string(),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export const approvalRequestInputSchema = approvalRequestSchema
  .pick({ type: true, bookingIds: true, parentLegId: true })
  .strict()
  .extend({ bookingIds: z.array(id).min(1).max(2) });
export type ApprovalRequestInput = z.infer<typeof approvalRequestInputSchema>;
export const approvalDecisionInputSchema = z
  .object({
    decision: z.enum(["approved", "declined", "revoked"]),
    reason: text,
    strategicAcknowledgement: z.boolean(),
  })
  .strict();
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionInputSchema>;
export const decisionWriteInputSchema = z
  .object({ requestId: id, decision: approvalDecisionInputSchema })
  .strict();
export type ApprovalDecision = ApprovalDecisionInput & {
  id: string;
  requestId: string;
  actor: PlanningActor;
  authorityRevision: number;
  planFingerprint: string;
  decidedAt: string;
};
export type ApprovalEvaluation = {
  state: "passed" | "pending" | "invalid";
  reasons: string[];
  splitGroupIds: string[];
  extraAdventureZone: boolean;
  extraPirates: boolean;
};
export type DecisionAuthorization =
  | { allowed: true }
  | {
      allowed: false;
      code:
        | "AUTHORITY_REQUIRED"
        | "STALE_APPROVAL"
        | "EVIDENCE_REQUIRED"
        | "PLAN_CONFLICT";
    };
export const readinessStateSchema = z.enum([
  "conflict",
  "needs_review",
  "needs_details",
  "verified_plan",
]);
export type ReadinessState = z.infer<typeof readinessStateSchema>;
export const readinessDimensionSchema = z.object({
  state: readinessStateSchema,
  reasons: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      href: z.string().nullable(),
    }),
  ),
});
export type ReadinessDimension = z.infer<typeof readinessDimensionSchema>;
export const readinessResultSchema = z.object({
  overall: readinessStateSchema,
  dimensions: z.object({
    crew: readinessDimensionSchema,
    equipment: readinessDimensionSchema,
    dates_travel: readinessDimensionSchema,
    accommodation: readinessDimensionSchema,
    approval: readinessDimensionSchema,
  }),
  evaluatedAt: z.string(),
  factsFingerprint: z.string(),
});
export type ReadinessResult = z.infer<typeof readinessResultSchema>;
export type PlanObligation = {
  canonicalId: string;
  bookingId: string;
  legId: string | null;
  window: OperationalWindow;
  workerIds: string[];
  resourceIds: string[];
  packageQuantities: Record<string, number>;
  splitGroupId: string | null;
  linkedBookingIds?: string[];
  crewWindows?: Array<{ workerId: string; window: OperationalWindow }>;
};
export type PlanFacts = {
  draft: PlanDraft;
  committed?: PlanDraft | null;
  revision: number;
  booking: {
    id: string;
    legId: string | null;
    status: string;
    seasonYear: number | null;
    window: WindowInput | null;
    publicWindow?: WindowInput | null;
    packageIds: string[];
  };
  season: LegSeasonPlan | null;
  workers: Array<{ id: string; name: string; rehireStatus: string }>;
  availability: CrewAvailability[];
  packageSets: PackageSet[];
  packages: Array<{
    id: string;
    code: string;
    name: string;
    normalCapacity: number;
    unavailableQuantity: number;
  }>;
  resources: Array<{
    id: string;
    name: string;
    category: string;
    status: string;
    minimumTransferMinutes: number;
  }>;
  obligations: PlanObligation[];
  bookingLegIds?: Record<string, string | null>;
  holds: PlanObligation[];
  split: SplitGroup | null;
  /** Server-derived from the exact branches' canonical December/January starts. */
  splitSeasonYear?: number | null;
  branches: PlanDraft[];
  travel: {
    endpointFingerprint: string;
    verified: boolean;
    source: string | null;
    verifiedAt: string | null;
    reasons: string[];
  };
  authority: DaveAuthority | null;
  authorityEnabled: boolean;
  authoritySessionVersion?: number;
  managerAccessVersions?: Record<string, number>;
  requests: ApprovalRequest[];
  approvalFingerprints?: Record<string, string>;
  capacityGrants?: Array<{
    bookingId: string;
    packageCode: string;
    window: OperationalWindow;
  }>;
  decisions: ApprovalDecision[];
  now: string;
  sourceReasons: string[];
};
export type PlanningRead = {
  split?: SplitGroup | null;
  plan: EventPlan | null;
  draft?: PlanDraft;
  catalog?: PlanningCatalog;
  travelReviewContext?: {
    endpointFingerprint: string;
    verified: boolean;
    reasons: string[];
  };
  readiness: ReadinessResult;
  actions: {
    edit: boolean;
    commit: boolean;
    request: boolean;
    decide: boolean;
  };
  requests: ApprovalRequest[];
  decisions: ApprovalDecision[];
};
export type PlanningCatalog = {
  enabled: true;
  legs: Array<{ id: string; name: string }>;
  workers: PlanFacts["workers"];
  availability: CrewAvailability[];
  packageSets: PackageSet[];
  resources: PlanFacts["resources"];
  packages: PlanFacts["packages"];
  bookings: Array<{
    id: string;
    name: string;
    legId: string | null;
    seasonYear: number | null;
    splitSeasonYears?: number[];
  }>;
  bossAccounts?: Array<{ id: string; name: string }>;
};
const actorSchema = z.union([
  z.object({ kind: z.literal("owner"), subject: z.string() }),
  z.object({
    kind: z.literal("boss"),
    accountId: id,
    sessionVersion: revision,
  }),
  z.object({ kind: z.literal("manager"), legId: id, sessionVersion: revision }),
]);
export const approvalDecisionSchema = approvalDecisionInputSchema.extend({
  id,
  requestId: id,
  actor: actorSchema,
  authorityRevision: revision,
  planFingerprint: text,
  decidedAt: z.string(),
});
export const planningCatalogSchema = z.object({
  enabled: z.literal(true),
  legs: z.array(z.object({ id, name: z.string() })),
  workers: z.array(
    z.object({ id, name: z.string(), rehireStatus: z.string() }),
  ),
  availability: z.array(crewAvailabilitySchema),
  packageSets: z.array(packageSetSchema),
  resources: z.array(
    z.object({
      id,
      name: z.string(),
      category: z.string(),
      status: z.string(),
      minimumTransferMinutes: z.number(),
    }),
  ),
  packages: z.array(
    z.object({
      id,
      name: z.string(),
      code: z.string(),
      normalCapacity: z.number(),
      unavailableQuantity: z.number(),
    }),
  ),
  bookings: z.array(
    z.object({
      id,
      name: z.string(),
      legId: id.nullable(),
      seasonYear: z.number().nullable(),
      splitSeasonYears: z.array(z.number().int()).optional(),
    }),
  ),
  bossAccounts: z.array(z.object({ id, name: z.string() })).optional(),
});
export const planningReadSchema = z.object({
  split: splitGroupSchema.nullable().optional(),
  plan: eventPlanSchema.nullable(),
  draft: planDraftSchema.optional(),
  catalog: planningCatalogSchema.optional(),
  readiness: readinessResultSchema,
  actions: z.object({
    edit: z.boolean(),
    commit: z.boolean(),
    request: z.boolean(),
    decide: z.boolean(),
  }),
  requests: z.array(approvalRequestSchema),
  decisions: z.array(approvalDecisionSchema),
  travelReviewContext: z
    .object({
      endpointFingerprint: z.string(),
      verified: z.boolean(),
      reasons: z.array(z.string()),
    })
    .optional(),
});
export const planningApprovalReviewSchema = z.object({
  request: approvalRequestSchema,
  plans: z.array(planningReadSchema),
  canDecide: z.boolean(),
});
export type MutationResult<T> = {
  receiptId: string;
  value: T;
  affectedBookingIds: string[];
  idempotent: boolean;
};
export type RevisionWrite<T> = {
  payload: T;
  requestKey: string;
  expectedRevision: number | null;
};
export const revisionWriteSchema = <T extends z.ZodType>(payload: T) =>
  z
    .object({
      payload,
      requestKey: z.string().min(1).max(200),
      expectedRevision: revision.nullable(),
    })
    .strict();
export const commitPlansInputSchema = z
  .object({
    bookingIds: z.array(id).min(1).max(2),
    expectedRevisions: z.record(id, revision),
    requestKey: z.string().min(1).max(200),
  })
  .strict();
