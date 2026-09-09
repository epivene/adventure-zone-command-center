import { z } from "zod";

const scheduleDateSchema = z.coerce.date().transform((value) => value.toISOString());
const nullableScheduleDateSchema = z.coerce.date().nullable().transform((value) => value?.toISOString() ?? null);

export const managerScheduleStateSchema = z.enum(["booked", "potential", "excluded"]);

export const managerScheduleEventSchema = z.object({
  bookingId: z.string(),
  bookingName: z.string(),
  city: z.string(),
  region: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  startsAt: nullableScheduleDateSchema,
  endsAt: nullableScheduleDateSchema,
  operationalStartsAt: nullableScheduleDateSchema.optional(),
  operationalEndsAt: nullableScheduleDateSchema.optional(),
  status: z.string(),
  probability: z.string().nullable(),
  scheduleState: managerScheduleStateSchema,
}).strict();

export const managerScheduleTripSchema = z.object({
  id: z.string(),
  travelLegId: z.string(),
  name: z.string(),
  startDate: scheduleDateSchema,
  endDate: scheduleDateSchema,
  startLabel: z.string(),
  startLatitude: z.number().nullable(),
  startLongitude: z.number().nullable(),
  endLabel: z.string(),
  endLatitude: z.number().nullable(),
  endLongitude: z.number().nullable(),
  legName: z.string().optional(),
  legColor: z.string().nullable().optional(),
  mpg: z.number().nullable().optional(),
  fuelPricePerGallon: z.number().nullable().optional(),
}).strict();

const managerScheduleRouteTripSchema = z.object({
  id: z.string(),
  name: z.string(),
  startLabel: z.string(),
  startLatitude: z.number().nullable(),
  startLongitude: z.number().nullable(),
  endLabel: z.string(),
  endLatitude: z.number().nullable(),
  endLongitude: z.number().nullable(),
  mpg: z.number().nullable(),
  fuelPricePerGallon: z.number().nullable(),
}).strict();

const managerScheduleStopSchema = managerScheduleEventSchema.extend({
  id: z.string(),
  sortOrder: z.number(),
}).strict();

const managerScheduleSegmentSchema = z.object({
  id: z.string(),
  fromLabel: z.string(),
  toLabel: z.string(),
  effectiveMiles: z.number().nullable(),
  effectiveMinutes: z.number().nullable(),
}).strict();

export const managerScheduleRouteSchema = z.object({
  trip: managerScheduleRouteTripSchema,
  stops: z.array(managerScheduleStopSchema),
  segments: z.array(managerScheduleSegmentSchema),
}).strict();

export const managerScheduleResponseSchema = z.object({
  leg: z.object({
    id: z.string(),
    name: z.string(),
    color: z.string().nullable(),
  }).strict(),
  trips: z.array(managerScheduleTripSchema),
  route: managerScheduleRouteSchema.nullable(),
  events: z.array(managerScheduleEventSchema),
}).strict();

const managerMeetupParticipantSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("leg"), legId: z.string(), legName: z.string() }).strict(),
  z.object({
    kind: z.literal("external_contact"),
    externalContactId: z.string().nullable(),
    displayName: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }).strict(),
]);

const managerMeetupSchema = z.object({
  id: z.string(),
  status: z.enum(["suggested", "dismissed", "approved", "needs_review"]),
  resourceName: z.string().nullable(),
  meetupLabel: z.string(),
  meetupLatitude: z.number(),
  meetupLongitude: z.number(),
  windowStartsAt: scheduleDateSchema,
  windowEndsAt: scheduleDateSchema,
  counterpart: managerMeetupParticipantSchema,
}).strict();

export const managerScopedMapResponseSchema = managerScheduleResponseSchema.extend({
  meetups: z.array(managerMeetupSchema),
}).strict();

const managerLifecycleSchema = z.object({
  bookingId: z.string(),
  bookingName: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  checkedInAt: nullableScheduleDateSchema.optional(),
  checkedOutAt: nullableScheduleDateSchema.optional(),
}).passthrough();

const managerMoneySchema = z.object({
  expenseTotalCents: z.number().optional(),
  cashPosition: z.object({
    cashOnHandCents: z.number().optional(),
  }).passthrough().optional(),
}).passthrough();

export const managerDashboardResponseSchema = managerScheduleResponseSchema.extend({
  legId: z.string(),
  nextEvent: managerScheduleEventSchema.nullable(),
  currentLifecycle: managerLifecycleSchema.nullable(),
  lifecycle: managerLifecycleSchema.nullable(),
  incompleteWrapUps: z.array(managerLifecycleSchema),
  wrapUps: z.array(managerLifecycleSchema),
  reviewsDue: z.array(z.unknown()),
  reviews: z.array(z.unknown()),
  money: managerMoneySchema,
  moneySummary: managerMoneySchema,
  summary: z.object({
    upcomingBookedEventsCount: z.number(),
    incompleteWrapUpsCount: z.number(),
    reviewsDueCount: z.number(),
  }).strict(),
  partialErrors: z.array(z.object({
    section: z.string(),
    message: z.string(),
  }).strict()),
}).strict();

export type ManagerScheduleState = z.infer<typeof managerScheduleStateSchema>;
export type ManagerScheduleEvent = z.output<typeof managerScheduleEventSchema>;
export type ManagerScheduleResponse = z.output<typeof managerScheduleResponseSchema>;
export type ManagerScopedMapResponse = z.output<typeof managerScopedMapResponseSchema>;
export type ManagerDashboardResponse = z.output<typeof managerDashboardResponseSchema>;