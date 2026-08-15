import { z } from "zod";

export const travelLegDetailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Travel leg name is required")
    .max(100, "Travel leg name is too long"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Choose a six-digit color")
    .transform((value) => value.toUpperCase()),
  baseAddress: z
    .string()
    .trim()
    .max(300, "Base address is too long")
    .optional()
    .nullable()
    .default("")
    .transform((value) => (value === "" ? null : value)),
  defaultVehicleName: z
    .string()
    .trim()
    .max(100, "Default vehicle name is too long")
    .optional()
    .nullable()
    .default("")
    .transform((value) => (value === "" ? null : value)),
  defaultMpg: z.preprocess(
    (value) => {
      if (value === "" || value === null || value === undefined) {
        return null;
      }
      if (typeof value === "string") {
        return Number(value);
      }
      return value;
    },
    z
      .number("Default MPG must be a number")
      .positive("Default MPG must be greater than zero")
      .max(1000, "Default MPG is too large")
      .nullable(),
  ),
});

const travelLegOrderItemSchema = z.object({
  id: z.uuid(),
  sortOrder: z.number().int().min(1).max(9),
});

function validateOrder(
  legs: Array<{ id: string; sortOrder: number }>,
  context: z.RefinementCtx,
) {
  const n = legs.length;
  const orders = legs.map((leg) => leg.sortOrder);
  const expected = Array.from({ length: n }, (_, i) => i + 1).join(",");
  if (
    new Set(orders).size !== n ||
    [...orders].sort((left, right) => left - right).join(",") !== expected
  ) {
    context.addIssue({
      code: "custom",
      message: `Travel-leg order must remain 1 through ${n}`,
      path: ["legs"],
    });
  }
  if (new Set(legs.map((leg) => leg.id)).size !== n) {
    context.addIssue({
      code: "custom",
      message: "Each travel leg must keep its unique record",
      path: ["legs"],
    });
  }
}

export const travelLegOrderSchema = z
  .object({
    legs: z
      .array(travelLegOrderItemSchema)
      .min(1, "At least one travel leg is required")
      .max(9, "At most nine travel legs are allowed"),
  })
  .superRefine((input, context) => validateOrder(input.legs, context));

export const travelLegConfigurationSchema = z
  .object({
    legs: z
      .array(
        z.object({
          id: z.uuid(),
          ...travelLegDetailsSchema.shape,
          sortOrder: z.number().int().min(1).max(9),
        }),
      )
      .min(1, "At least one travel leg is required")
      .max(9, "At most nine travel legs are allowed"),
  })
  .superRefine((input, context) => validateOrder(input.legs, context));

export type TravelLegDetails = z.output<typeof travelLegDetailsSchema>;
export type TravelLegOrder = z.output<typeof travelLegOrderSchema>;
export type TravelLegConfiguration = z.output<
  typeof travelLegConfigurationSchema
>;
