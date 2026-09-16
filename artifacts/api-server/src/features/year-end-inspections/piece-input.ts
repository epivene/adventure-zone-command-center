import { pieceLifecycleStatusValues } from "@workspace/db/year-end-inspection-schema";
import { z } from "zod";

const nullableText = (maximum: number) =>
  z.string().trim().max(maximum).nullable().default(null);

export const pieceInputSchema = z.object({
  id: z.string().uuid().optional(),
  clientMutationId: z.string().uuid().optional(),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  pieceType: z.string().trim().min(1).max(120).default("inflatable_component"),
  currentLegId: z.string().uuid().nullable(),
  storageLocation: nullableText(500),
  identityNotes: nullableText(12000),
  lifecycleStatus: z.enum(pieceLifecycleStatusValues).default("active"),
  resourceId: z.string().uuid().nullable().default(null),
}).strict();

export const piecePatchSchema = pieceInputSchema
  .omit({ id: true, clientMutationId: true, resourceId: true })
  .partial()
  .refine((input) => Object.keys(input).length > 0, "No piece changes provided");

export type PieceInput = z.infer<typeof pieceInputSchema>;
export type PiecePatch = z.infer<typeof piecePatchSchema>;
