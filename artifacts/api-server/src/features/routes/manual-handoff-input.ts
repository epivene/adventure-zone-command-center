import { z } from "zod";

const legParticipantSchema = z.object({ kind: z.literal("leg"), legId: z.string().uuid() });
const externalParticipantSchema = z.object({
  kind: z.literal("external_contact"),
  externalContactId: z.string().uuid().nullable().default(null),
  displayName: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(60).nullable().default(null),
  email: z.string().trim().email().max(200).nullable().default(null),
});
const participantSchema = z.discriminatedUnion("kind", [legParticipantSchema, externalParticipantSchema]);

export const manualHandoffSchema = z.object({
  fromParticipant: participantSchema,
  toParticipant: participantSchema,
  fromTripId: z.string().uuid().nullable().default(null),
  toTripId: z.string().uuid().nullable().default(null),
  resourceId: z.string().uuid(),
  meetupLabel: z.string().trim().min(1).max(240),
  meetupLatitude: z.number().min(-90).max(90),
  meetupLongitude: z.number().min(-180).max(180),
  windowStartsAt: z.coerce.date(),
  windowEndsAt: z.coerce.date(),
}).superRefine((value, context) => {
  if (value.fromParticipant.kind !== "leg" && value.toParticipant.kind !== "leg") {
    context.addIssue({ code: "custom", path: ["fromParticipant"], message: "At least one participant must be an Adventure Zone leg" });
  }
  if (value.fromParticipant.kind === "leg" && value.toParticipant.kind === "leg" && value.fromParticipant.legId === value.toParticipant.legId) {
    context.addIssue({ code: "custom", path: ["toParticipant"], message: "Choose two different legs" });
  }
  if (value.windowEndsAt < value.windowStartsAt) {
    context.addIssue({ code: "custom", path: ["windowEndsAt"], message: "Meetup end time cannot be before start time" });
  }
});
