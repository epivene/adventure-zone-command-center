import { z } from "zod";

import {
  bookingStatusValues,
  probabilityValues,
  type Probability,
} from "@/features/bookings/booking-types";
import { isActiveStatus } from "@/features/follow-ups/follow-up-policy";
import { parseBusinessDateInput } from "@/lib/business-date";

const optionalBusinessDateSchema = z
  .union([z.literal(""), z.null(), z.string(), z.date()])
  .transform((value, context) => {
    if (value === "" || value === null) return null;
    const parsed = parseBusinessDateInput(value);
    if (parsed) return parsed;
    context.addIssue({
      code: "custom",
      message: "Choose a valid calendar date",
    });
    return z.NEVER;
  });

const coreBookingInputShape = {
  name: z.string().trim().min(1, "Event name is required"),
  city: z.string().trim().min(1, "City is required"),
  region: z.string().trim().min(2, "State is required"),
  probability: z.enum(probabilityValues),
};

const nullableTrimmedString = z
  .union([z.string(), z.null()])
  .transform((value) => value?.trim() || null);

function nullableCoordinate(
  label: string,
  minimum: number,
  maximum: number,
) {
  return z
    .union([z.string(), z.number(), z.null()])
    .transform((value, context) => {
      if (
        value === null ||
        (typeof value === "string" && value.trim() === "")
      ) {
        return null;
      }
      const coordinate =
        typeof value === "number" ? value : Number(value.trim());
      if (
        !Number.isFinite(coordinate) ||
        coordinate < minimum ||
        coordinate > maximum
      ) {
        context.addIssue({
          code: "custom",
          message: `${label} must be between ${minimum} and ${maximum}`,
        });
        return z.NEVER;
      }
      return coordinate;
    });
}

export const bookingEditInputSchema = z
  .object({
    ...coreBookingInputShape,
    venueName: nullableTrimmedString,
    address1: nullableTrimmedString,
    postalCode: nullableTrimmedString,
    latitude: nullableCoordinate("Latitude", -90, 90),
    longitude: nullableCoordinate("Longitude", -180, 180),
    startsAt: optionalBusinessDateSchema,
    endsAt: optionalBusinessDateSchema,
    status: z.enum(bookingStatusValues),
    travelLegId: z
      .union([z.literal(""), z.null(), z.string().uuid()])
      .transform((value) => value || null),
    notes: nullableTrimmedString,
  })
  .superRefine((input, context) => {
    if ((input.latitude === null) !== (input.longitude === null)) {
      context.addIssue({
        code: "custom",
        message: "Enter both latitude and longitude, or clear both",
        path: [input.latitude === null ? "latitude" : "longitude"],
      });
    }
    if (
      input.status === "confirmed" &&
      (input.latitude === null || input.longitude === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Map this confirmed event before saving",
        path: ["latitude"],
      });
    }

    // Normalize again at the cross-field boundary instead of assuming the
    // values reaching superRefine are already Date instances. This keeps a
    // string-shaped PATCH payload from throwing before Zod can return a
    // validation result.
    const startsAt = parseBusinessDateInput(input.startsAt);
    const endsAt = parseBusinessDateInput(input.endsAt);
    if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) {
      context.addIssue({
        code: "custom",
        message: "End date cannot be before the start date",
        path: ["endsAt"],
      });
    }
  })
  .transform((input) => ({
    ...input,
    region: input.region.toUpperCase(),
    probability: input.status === "confirmed" ? "definite" : input.probability,
  }));

export const bookingInputSchema = z
  .object({
    ...coreBookingInputShape,
    status: z.enum(bookingStatusValues),
    travelLegId: z
      .union([z.literal(""), z.null(), z.string().uuid()])
      .transform((value) => value || null),
    nextActionKind: z.string(),
    nextActionDueAt: optionalBusinessDateSchema,
  })
  .superRefine((input, context) => {
    if (!isActiveStatus(input.status)) return;

    if (!input.nextActionKind.trim()) {
      context.addIssue({
        code: "custom",
        message: "Choose the next action",
        path: ["nextActionKind"],
      });
    }

    if (!input.nextActionDueAt) {
      context.addIssue({
        code: "custom",
        message: "Choose the next follow-up date",
        path: ["nextActionDueAt"],
      });
    }
  })
  .transform((input) => ({
    ...input,
    region: input.region.toUpperCase(),
    probability: input.status === "confirmed" ? "definite" : input.probability,
    nextActionKind: input.nextActionKind.trim(),
    nextActionDueAt: input.nextActionDueAt,
  }));

type BookingFormOutput = z.output<typeof bookingInputSchema>;
type BookingEditOutput = z.output<typeof bookingEditInputSchema>;

// Keep repository-facing write types aligned with the shared Drizzle schema
// until its generated probability enum is regenerated. Runtime parsing accepts
// and persists "definite" after migration; API routes deliberately pass parsed
// data across this persistence boundary.
export type BookingFormInput = Omit<BookingFormOutput, "probability"> & {
  probability: Probability;
};
export type BookingEditInput = Omit<BookingEditOutput, "probability"> & {
  probability: Probability;
};
