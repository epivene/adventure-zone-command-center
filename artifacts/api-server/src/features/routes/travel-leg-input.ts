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
          sortOrder: z.number().int().min(1).max(4),
        }),
      )
      .length(4, "Exactly four travel legs are required"),
  })
  .superRefine((input, context) => {
    const orders = input.legs.map((leg) => leg.sortOrder);
    if (
      new Set(orders).size !== 4 ||
      [...orders].sort((left, right) => left - right).join(",") !== "1,2,3,4"
    ) {
      context.addIssue({
        code: "custom",
        message: "Travel-leg order must remain 1 through 4",
        path: ["legs"],
      });
    }
    if (new Set(input.legs.map((leg) => leg.id)).size !== 4) {
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
