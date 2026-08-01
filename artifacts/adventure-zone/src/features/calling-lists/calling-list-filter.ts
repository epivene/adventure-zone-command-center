import { z } from "zod";

export const callingListPredicateFields = [
  "person.city",
  "person.region",
  "person.job_title",
  "place.id",
  "place.place_type",
  "place.city",
  "place.region",
] as const;

export type CallingListPredicateField =
  (typeof callingListPredicateFields)[number];

export type CallingListFilterV1Predicate =
  | {
      op: "predicate";
      field: CallingListPredicateField;
      operator: "eq";
      value: string;
    }
  | {
      op: "predicate";
      field: CallingListPredicateField;
      operator: "in";
      value: string[];
    }
  | {
      op: "predicate";
      field: CallingListPredicateField;
      operator: "is_empty" | "is_not_empty";
    };

export type CallingListFilterV1Where =
  | {
      op: "and" | "or";
      clauses: CallingListFilterV1Where[];
    }
  | CallingListFilterV1Predicate;

export type CallingListFilterV1 = {
  version: 1;
  entity: "person";
  where: CallingListFilterV1Where;
};

const callingListPredicateSchema = z.union([
  z
    .object({
      op: z.literal("predicate"),
      field: z.enum(callingListPredicateFields),
      operator: z.literal("eq"),
      value: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("predicate"),
      field: z.enum(callingListPredicateFields),
      operator: z.literal("in"),
      value: z.array(z.string()).min(1),
    })
    .strict(),
  z
    .object({
      op: z.literal("predicate"),
      field: z.enum(callingListPredicateFields),
      operator: z.literal("is_empty"),
    })
    .strict(),
  z
    .object({
      op: z.literal("predicate"),
      field: z.enum(callingListPredicateFields),
      operator: z.literal("is_not_empty"),
    })
    .strict(),
]);

const MAX_FILTER_DEPTH = 8;
const MAX_FILTER_CLAUSES = 50;

const callingListFilterWhereSchema: z.ZodType<CallingListFilterV1Where> =
  z.lazy(() =>
    z.union([
      callingListPredicateSchema,
      z
        .object({
          op: z.union([z.literal("and"), z.literal("or")]),
          clauses: z.array(callingListFilterWhereSchema).min(1),
        })
        .strict(),
    ]),
  );

export const callingListFilterV1Schema: z.ZodType<CallingListFilterV1> = z
  .object({
    version: z.literal(1),
    entity: z.literal("person"),
    where: callingListFilterWhereSchema,
  })
  .strict()
  .superRefine((filter, context) => {
    let clauseCount = 0;

    const inspect = (where: CallingListFilterV1Where, depth: number) => {
      if (depth >= MAX_FILTER_DEPTH) {
        context.addIssue({
          code: "custom",
          message: `Calling-list filters may not exceed ${MAX_FILTER_DEPTH} levels.`,
        });
        return;
      }
      if (where.op === "predicate") return;

      clauseCount += where.clauses.length;
      for (const clause of where.clauses) {
        inspect(clause, depth + 1);
      }
    };

    inspect(filter.where, 0);
    if (clauseCount > MAX_FILTER_CLAUSES) {
      context.addIssue({
        code: "custom",
        message: `Calling-list filters may not exceed ${MAX_FILTER_CLAUSES} clauses.`,
      });
    }
  });

export function parseCallingListFilterV1(value: unknown): CallingListFilterV1 {
  return callingListFilterV1Schema.parse(value);
}
