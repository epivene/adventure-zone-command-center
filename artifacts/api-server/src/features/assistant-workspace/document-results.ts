import { publicResearchSchema } from "./public-research";
import { z } from "zod";
import type { SavedRun } from "./run-store";
const comparison = z.object({
  view: z.literal("document_comparison"),
  complete: z.boolean(),
  sources: z
    .array(
      z.object({
        id: z.string().uuid(),
        title: z.string(),
        category: z.string(),
        organizationIds: z.array(z.string()),
        eventYear: z.number().nullable(),
        version: z.string(),
        complete: z.boolean(),
        totalPages: z.number().nullable(),
        missingPages: z.array(z.number()),
        cacheHit: z.boolean().optional(),
        extractedAt: z.iso.datetime().nullable().optional(),
      }),
    )
    .max(4),
});
const reading = z.object({
  view: z.literal("document_reading"),
  documentId: z.string().uuid().nullable(),
  sourceLabel: z.string().max(120),
  version: z.string().nullable(),
  eventYear: z.number().nullable(),
  complete: z.boolean(),
  totalPages: z.number(),
  missingPages: z.array(z.number()).max(100),
  cacheHit: z.boolean().optional(),
  extractedAt: z.iso.datetime().optional(),
  extractionModel: z.string().nullable().optional(),
});
const commercial = z.object({
  view: z.literal("commercial_records"),
  profile: z.object({ id: z.string(), name: z.string() }),
  eventYear: z.number(),
  totals: z.object({
    outstandingCents: z.number(),
    depositRemainingCents: z.number(),
    recordedPaidCents: z.number(),
  }),
  unclassified: z.object({
    invoices: z.array(z.object({ id: z.string() })),
    contracts: z.array(z.object({ id: z.string() })),
  }),
  historicalCount: z.number(),
});
const schema = z.discriminatedUnion("view", [
  comparison,
  reading,
  commercial,
  publicResearchSchema,
]);
// Only these presentation fields leave the durable checkpoint. Source bodies,
// provider state and model reasoning are never serialized by the HTTP route.
export function publicDocumentResults(runs: Pick<SavedRun, "id" | "turn">[]) {
  return runs
    .flatMap((run) =>
      Object.entries(run.turn?.results ?? {}).flatMap(([id, result]) => {
        const parsed = schema.safeParse(result.data);
        return parsed.success
          ? [
              {
                id: `${run.id}:${id}`,
                retrievedAt: result.evidence[0]?.retrievedAt ?? null,
                data: parsed.data,
              },
            ]
          : [];
      }),
    )
    .slice(0, 12);
}
