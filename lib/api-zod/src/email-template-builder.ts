import { z } from "zod";

export const EMAIL_BUILDER_DOCUMENT_VERSION = 1 as const;

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color.");
const blockIdSchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const shortText = z.string().max(500);
const longText = z.string().max(30_000);
const paddingSchema = z.number().int().min(0).max(80);
const alignSchema = z.enum(["left", "center", "right"]);

function hasSafeUrlScheme(value: string) {
  if (!value) return true;
  return /^(?:https?:\/\/|mailto:|tel:)/i.test(value);
}

const destinationSchema = z.string().trim().max(2_000).refine(hasSafeUrlScheme, "Use an http, https, mailto, or tel link.");
const imageSourceSchema = z.string().trim().min(1).max(4_000).refine((value) => {
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(value)) return true;
  return /^https?:\/\//i.test(value);
}, "Use an http, https, or supported image data URL.");

const common = {
  id: blockIdSchema,
  sourceHtml: z.string().max(100_000).optional(),
};

const logoHeaderSchema = z.object({
  ...common,
  type: z.literal("logoHeader"),
  imageUrl: imageSourceSchema,
  altText: shortText,
  width: z.number().int().min(80).max(560),
  align: alignSchema,
  backgroundColor: colorSchema,
  padding: paddingSchema,
}).strict();

const heroSchema = z.object({
  ...common,
  type: z.literal("hero"),
  eyebrow: shortText,
  headline: shortText,
  highlightedText: shortText,
  supportingText: z.string().max(2_000),
  backgroundColor: colorSchema,
  textColor: colorSchema,
  accentColor: colorSchema,
  highlightColor: colorSchema,
  padding: paddingSchema,
}).strict();

const textSchema = z.object({
  ...common,
  type: z.literal("text"),
  content: longText,
  contentFormat: z.enum(["plain", "rich_text"]).optional(),
  backgroundColor: colorSchema,
  textColor: colorSchema,
  align: alignSchema,
  padding: paddingSchema,
}).strict();

const imageSchema = z.object({
  ...common,
  type: z.literal("image"),
  imageUrl: imageSourceSchema,
  altText: shortText,
  linkUrl: destinationSchema,
  width: z.number().int().min(40).max(640),
  height: z.number().int().min(0).max(800),
  borderColor: colorSchema,
  backgroundColor: colorSchema,
  padding: paddingSchema,
}).strict();

const videoThumbnailSchema = z.object({
  ...common,
  type: z.literal("videoThumbnail"),
  imageUrl: imageSourceSchema,
  altText: shortText,
  linkUrl: destinationSchema.refine(Boolean, "Add the website video page link."),
  label: shortText,
  backgroundColor: colorSchema,
  borderColor: colorSchema,
  padding: paddingSchema,
}).strict();

const packageCardSchema = z.object({
  imageUrl: imageSourceSchema,
  altText: shortText,
  label: shortText,
  linkUrl: destinationSchema,
}).strict();

const packageCardsSchema = z.object({
  ...common,
  type: z.literal("packageCards"),
  cards: z.array(packageCardSchema).min(1).max(3),
  backgroundColor: colorSchema,
  cardColor: colorSchema,
  textColor: colorSchema,
  accentColor: colorSchema,
  padding: paddingSchema,
}).strict();

const offerCalloutSchema = z.object({
  ...common,
  type: z.literal("offerCallout"),
  eyebrow: shortText,
  title: z.string().max(1_000),
  description: z.string().max(4_000),
  backgroundColor: colorSchema,
  textColor: colorSchema,
  accentColor: colorSchema,
  padding: paddingSchema,
}).strict();

const buttonSchema = z.object({ label: shortText, url: destinationSchema.refine(Boolean, "Add a button link.") }).strict();
const buttonRowSchema = z.object({
  ...common,
  type: z.literal("buttonRow"),
  buttons: z.array(buttonSchema).min(1).max(2),
  backgroundColor: colorSchema,
  buttonColor: colorSchema,
  textColor: colorSchema,
  align: alignSchema,
  padding: paddingSchema,
}).strict();

const dividerSchema = z.object({
  ...common,
  type: z.literal("divider"),
  color: colorSchema,
  backgroundColor: colorSchema,
  thickness: z.number().int().min(1).max(12),
  padding: paddingSchema,
}).strict();

const spacerSchema = z.object({ ...common, type: z.literal("spacer"), backgroundColor: colorSchema, height: z.number().int().min(4).max(120) }).strict();

const signatureSchema = z.object({
  ...common,
  type: z.literal("signature"),
  closing: z.string().max(2_000),
  backgroundColor: colorSchema,
  textColor: colorSchema,
  padding: paddingSchema,
}).strict();

const footerSchema = z.object({
  ...common,
  type: z.literal("footer"),
  businessName: shortText,
  tagline: shortText,
  email: shortText,
  phone: shortText,
  websiteUrl: destinationSchema,
  backgroundColor: colorSchema,
  textColor: colorSchema,
  accentColor: colorSchema,
  padding: paddingSchema,
}).strict();

const customHtmlSchema = z.object({ ...common, type: z.literal("customHtml"), html: z.string().max(100_000) }).strict();

export const emailBuilderBlockSchema = z.discriminatedUnion("type", [
  logoHeaderSchema,
  heroSchema,
  textSchema,
  imageSchema,
  videoThumbnailSchema,
  packageCardsSchema,
  offerCalloutSchema,
  buttonRowSchema,
  dividerSchema,
  spacerSchema,
  signatureSchema,
  footerSchema,
  customHtmlSchema,
]);

export const emailBuilderDocumentSchema = z.object({
  version: z.literal(EMAIL_BUILDER_DOCUMENT_VERSION),
  settings: z.object({
    backgroundColor: colorSchema,
    contentWidth: z.literal(640),
    preheader: z.string().max(500).optional(),
    sourceHtml: z.string().max(100_000).optional(),
  }).strict(),
  blocks: z.array(emailBuilderBlockSchema).min(1).max(100),
}).strict().superRefine((document, context) => {
  if (new Set(document.blocks.map((block) => block.id)).size !== document.blocks.length) {
    context.addIssue({ code: "custom", path: ["blocks"], message: "Block IDs must be unique." });
  }
  if (JSON.stringify(document).length > 500_000) {
    context.addIssue({ code: "custom", message: "Email document is too large." });
  }
});

export type EmailBuilderBlock = z.infer<typeof emailBuilderBlockSchema>;
export type EmailBuilderDocument = z.infer<typeof emailBuilderDocumentSchema>;
