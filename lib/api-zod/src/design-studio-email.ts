import { z } from "zod";

export const designEmailBlockTypeValues = [
  "header",
  "hero",
  "heading",
  "paragraph",
  "button",
  "divider",
  "spacer",
  "footer",
] as const;

const safeText = (maximum: number) => z.string().max(maximum);
const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

export const designEmailBlockSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    type: z.enum(designEmailBlockTypeValues),
    label: safeText(240),
    content: safeText(20_000),
    link: safeText(2_000),
    showOnMobile: z.boolean(),
  })
  .strict();

export const designEmailMediaReferenceSchema = z
  .object({
    assetId: z.string().uuid().nullable(),
    src: safeText(2_000).nullable(),
    alt: safeText(500),
    name: safeText(240),
  })
  .strict();

export const designEmailBrandKitSchema = z
  .object({
    name: safeText(240),
    primaryColor: colorSchema,
    accentColor: colorSchema,
    textColor: colorSchema,
    backgroundColor: colorSchema,
    typography: safeText(240),
    highContrastButtons: z.boolean(),
  })
  .strict();

export const designEmailDocumentSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("branded-email"),
    blocks: z.array(designEmailBlockSchema).max(100),
    hero: designEmailMediaReferenceSchema,
    brandKit: designEmailBrandKitSchema,
  })
  .strict();

export type DesignEmailBlockType = (typeof designEmailBlockTypeValues)[number];
export type DesignEmailBlock = z.infer<typeof designEmailBlockSchema>;
export type DesignEmailMediaReference = z.infer<
  typeof designEmailMediaReferenceSchema
>;
export type DesignEmailBrandKit = z.infer<typeof designEmailBrandKitSchema>;
export type DesignEmailDocument = z.infer<typeof designEmailDocumentSchema>;
