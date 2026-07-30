import { z } from "zod";

const bookingPersonSelectionSchema = z.object({
  contactId: z.uuid(),
  role: z
    .union([z.string().max(200), z.null()])
    .transform((value) => value?.trim() || null),
  isPrimary: z.boolean(),
});

export const changeBookingPlaceSchema = z.object({
  bookingId: z.uuid(),
  organizationId: z.uuid(),
});

export const replaceBookingPeopleSchema = z.object({
  bookingId: z.uuid(),
  people: z.array(bookingPersonSelectionSchema).max(100),
}).superRefine((value, context) => {
  const ids = value.people.map((person) => person.contactId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      path: ["people"],
      message: "Select each Person once",
    });
  }
  if (value.people.filter((person) => person.isPrimary).length > 1) {
    context.addIssue({
      code: "custom",
      path: ["people"],
      message: "Choose at most one primary Person",
    });
  }
});

export type BookingPersonSelection = z.infer<
  typeof bookingPersonSelectionSchema
>;
export type ChangeBookingPlaceInput = z.input<typeof changeBookingPlaceSchema>;
export type ReplaceBookingPeopleInput = z.input<
  typeof replaceBookingPeopleSchema
>;
