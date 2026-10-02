import { z } from "zod";

const nullableText = z.string().nullable();
import {
  safeOperationsHref as safeHref,
  operationsSourceSchema,
} from "./operations-source";
export { operationsSourceSchema } from "./operations-source";
import { planningReadSchema } from "./leg-planning";
export const operationsLegSchema = z.object({
  id: z.string(),
  name: z.string(),
  archived: z.boolean(),
});
export type OperationsViewer =
  { kind: "owner" | "boss" } | { kind: "manager"; legId: string };

export const operationsBookingOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  seasonYear: z.number().int().nullable(),
  startsAt: nullableText,
  endsAt: nullableText,
});
export type OperationsBookingOption = z.infer<
  typeof operationsBookingOptionSchema
>;
export const operationsHistoryItemSchema = z.object({
  bookingId: z.string(),
  profileId: z.string(),
  name: z.string(),
  seasonYear: z.number().int().nullable(),
  relation: z.enum(["same_profile", "event_family"]),
  leg: operationsLegSchema.nullable(),
  packageNames: z.array(z.string()),
  startsAt: nullableText,
  endsAt: nullableText,
  sources: z.array(operationsSourceSchema),
});
export type OperationsHistoryItem = z.infer<typeof operationsHistoryItemSchema>;
export const operationsHistorySchema = z.object({
  basis: z.enum(["previous_season", "last_known", "none"]),
  items: z.array(operationsHistoryItemSchema),
  hasMore: z.boolean(),
  historyHref: safeHref.nullable(),
  coverage: z.enum(["saved_records_only", "review_pending"]),
});
export type HistoryView = z.infer<typeof operationsHistorySchema>;
export const operationsAssignmentSchema = z.object({
  assignedLeg: operationsLegSchema.nullable(),
  suggestion: z
    .object({
      leg: operationsLegSchema,
      explanation: z.string(),
      source: z.string(),
      confidence: z.string(),
      warning: nullableText,
    })
    .nullable(),
  assignmentSource: nullableText,
});
export type AssignmentView = z.infer<typeof operationsAssignmentSchema>;
export const operationsDateWindowsSchema = z.object({
  publicStartsAt: nullableText,
  publicEndsAt: nullableText,
  reservedStartsAt: nullableText,
  reservedEndsAt: nullableText,
  reservedSource: nullableText,
  reservedEndExclusive: z.boolean().optional(),
});
export type DateWindows = z.infer<typeof operationsDateWindowsSchema>;
export const operationsResourcesSchema = z.object({
  packageNames: z.array(z.string()),
  allocations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      quantity: z.number(),
      status: z.string(),
    }),
  ),
  warnings: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(["warning", "blocking"]),
      message: z.string(),
      href: safeHref,
    }),
  ),
  pendingRequestCount: z.number().int().nonnegative(),
});
export type ResourcesView = z.infer<typeof operationsResourcesSchema>;
const stop = z.object({
  bookingId: z.string(),
  name: z.string(),
  startsAt: nullableText,
  endsAt: nullableText,
});
export const operationsRouteSchema = z.object({
  previous: stop.nullable(),
  next: stop.nullable(),
  previousDriveMinutes: z.number().nullable(),
  nextDriveMinutes: z.number().nullable(),
  estimateSource: nullableText,
  estimatedAt: nullableText,
});
export type RouteView = z.infer<typeof operationsRouteSchema>;
export const operationsCrewSchema = z.object({
  assignments: z.array(
    z.object({ id: z.string(), name: z.string(), role: z.string() }),
  ),
  history: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
      seasonYear: z.number().int().nullable(),
    }),
  ),
});
export type CrewView = z.infer<typeof operationsCrewSchema>;
export const operationsLodgingSchema = z.object({
  items: z.array(
    z.object({ id: z.string(), kind: z.string(), description: z.string() }),
  ),
});
export type LodgingView = z.infer<typeof operationsLodgingSchema>;
export const operationsWorkSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      nextAction: z.string(),
      href: safeHref,
    }),
  ),
});
export type WorkView = z.infer<typeof operationsWorkSchema>;
export const operationsCalendarSchema = z.object({
  connectionStatus: z.enum([
    "connected",
    "reauthorization_required",
    "disconnected",
    "unknown",
  ]),
  lastErrorCode: nullableText,
  pendingReviewCount: z.number().int().nonnegative(),
});
export type CalendarView = z.infer<typeof operationsCalendarSchema>;
export type OperationsSection<T> =
  | { state: "loaded"; data: T }
  | { state: "not_recorded" | "unavailable" | "restricted"; message: string };
function section<T extends z.ZodTypeAny>(data: T) {
  return z.union([
    z.object({ state: z.literal("loaded"), data }),
    z.object({
      state: z.enum(["not_recorded", "unavailable", "restricted"]),
      message: z.string(),
    }),
  ]);
}
export const bookingLegOperationsSchema = z.object({
  bookingId: z.string(),
  profileId: nullableText,
  seasonYear: z.number().int().nullable(),
  bookingStatus: z.string(),
  assignment: section(operationsAssignmentSchema),
  history: section(operationsHistorySchema),
  dates: section(operationsDateWindowsSchema),
  resources: section(operationsResourcesSchema),
  route: section(operationsRouteSchema),
  crew: section(operationsCrewSchema),
  lodging: section(operationsLodgingSchema),
  work: section(operationsWorkSchema),
  calendar: section(operationsCalendarSchema),
  planning: section(planningReadSchema).optional(),
});
export type BookingLegOperations = z.infer<typeof bookingLegOperationsSchema>;
