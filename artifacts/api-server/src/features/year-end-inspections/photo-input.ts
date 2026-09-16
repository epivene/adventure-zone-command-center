import { z } from "zod";

const normalizedNumber = z.number().finite().min(0).max(1);
export const annotationDocumentSchema = z.object({
  version: z.literal(1),
  ellipses: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    x: normalizedNumber,
    y: normalizedNumber,
    radiusX: normalizedNumber.refine((value) => value > 0, "Circle width must be positive"),
    radiusY: normalizedNumber.refine((value) => value > 0, "Circle height must be positive"),
  }).strict()).max(50),
}).strict();

export const photoMetadataInputSchema = z.object({
  id: z.string().uuid(),
  clientMutationId: z.string().uuid(),
  inspectionId: z.string().uuid(),
  entryId: z.string().uuid(),
  legId: z.string().uuid(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  description: z.string().trim().max(4000).nullable().default(null),
  annotations: annotationDocumentSchema.default({ version: 1, ellipses: [] }),
}).strict();

export const photoPatchSchema = z.object({
  description: z.string().trim().max(4000).nullable(),
  annotations: annotationDocumentSchema,
}).strict();

export type PhotoMetadataInput = z.infer<typeof photoMetadataInputSchema>;
export type PhotoPatch = z.infer<typeof photoPatchSchema>;
