import { z } from "zod";

export const travelLegConfigurationSchema = z
  .object({
    legs: z
      .array(
        z.object({
          id: z.uuid(),
          name: z
            .string()
            .trim()
            .min(1, "Travel leg name is required")
            .max(100, "Travel leg name is too long"),
          color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/, "Choose a six-digit color")
            .transform((value) => value.toUpperCase()),
          sortOrder: z.number().int().min(1).max(9),
          baseAddress: z
            .string()
            .trim()
            .max(300, "Base address is too long")
            .optional()
            .default("")
            .transform((value) => (value === "" ? null : value)),
          defaultVehicleName: z
            .string()
            .trim()
            .max(100, "Default vehicle name is too long")
            .optional()
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
        }),
      )
      .min(1, "At least one travel leg is required")
      .max(9, "At most nine travel legs are allowed"),
  })
  .superRefine((input, context) => {
    const n = input.legs.length;
    const orders = input.legs.map((leg) => leg.sortOrder);
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
    if (new Set(input.legs.map((leg) => leg.id)).size !== n) {
      context.addIssue({
        code: "custom",
        message: "Each travel leg must keep its unique record",
        path: ["legs"],
      });
    }
  });

export type TravelLegConfiguration = z.output<
  typeof travelLegConfigurationSchema
>;
