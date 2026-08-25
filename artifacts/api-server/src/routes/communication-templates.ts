import { eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import { communicationTemplates, officeAccounts } from "@/db/schema";
import { CommunicationTemplateRepository } from "@/features/communication-templates/communication-template-repository";
import { ensureCommunicationTemplateSeed } from "@/features/communication-templates/communication-template-seed";
import { ensureRouteFillOutreachTemplateSeed } from "@/features/communication-templates/route-fill-outreach-template-seed";
import { validateAuthoredTemplateText } from "@/features/communication-templates/communication-template-authoring";
import {
  allowedTemplatePlaceholders,
  extractTemplateTokens,
  renderCommunicationTemplateText,
} from "@/features/communication-templates/communication-template-renderer";
import type { TemplatePlaceholder } from "@/features/communication-templates/communication-template-types";

const router: IRouter = Router();
const placeholderSchema = z.enum(allowedTemplatePlaceholders);

export const communicationTemplateWriteSchema = z.object({
  code: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(160),
  channel: z.enum(["email", "internal_email"]),
  category: z.string().trim().min(1).max(120),
  subjectTemplate: z.string().max(2000).nullable(),
  bodyTemplate: z.string().trim().min(1).max(20000),
  requiredPlaceholders: z.array(placeholderSchema),
  accessScope: z.enum(["owner", "office"]),
}).strict();

const communicationTemplatePatchSchema = communicationTemplateWriteSchema
  .omit({ code: true }).partial().strict()
  .refine((value) => Object.keys(value).length > 0, "No template changes provided.");
const previewSchema = z.object({ values: z.record(z.string(), z.string().nullable()).default({}) }).strict();

function validateCopy(subjectTemplate: string | null, bodyTemplate: string) {
  return validateAuthoredTemplateText({ subjectTemplate, bodyTemplate }).placeholders;
}
function templateId(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
async function seed() {
  await ensureCommunicationTemplateSeed(db);
  await ensureRouteFillOutreachTemplateSeed(db);
}

router.get("/communication-templates", async (req, res): Promise<void> => {
  try {
    await seed();
    const rows = await db.select().from(communicationTemplates);
    const creatorIds = [...new Set(rows
      .filter((row) => row.createdByKind === "office_user" && row.createdById)
      .map((row) => row.createdById as string))];
    const creators = creatorIds.length
      ? await db.select({ id: officeAccounts.id, displayName: officeAccounts.displayName })
          .from(officeAccounts).where(inArray(officeAccounts.id, creatorIds))
      : [];
    const displayNameById = new Map(creators.map((creator) => [creator.id, creator.displayName]));
    res.json({ templates: rows.map((template) => ({
      ...template,
      creatorDisplayName: template.createdByKind === "office_user" && template.createdById
        ? displayNameById.get(template.createdById) ?? "Office Coordinator"
        : null,
    })) });
  } catch (err) {
    req.log.error({ err }, "Failed to list communication templates");
    res.status(500).json({ error: "Could not load communication templates" });
  }
});

router.post("/communication-templates", async (req, res): Promise<void> => {
  const parsed = communicationTemplateWriteSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review this template." }); return; }
  try {
    const allowedPlaceholders = validateCopy(parsed.data.subjectTemplate, parsed.data.bodyTemplate);
    const rows = await db.insert(communicationTemplates).values({
      ...parsed.data, allowedPlaceholders, state: "draft", ownerKind: "company",
      ownerOfficeAccountId: null, createdByKind: "owner", createdById: null,
      sourceTemplateId: null, reviewedBy: String((req as any).userId ?? "owner"),
    }).returning();
    res.status(201).json({ template: rows[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create template";
    if (message === "INVALID_TEMPLATE_PLACEHOLDER") { res.status(400).json({ error: "Use only approved template placeholders." }); return; }
    req.log.error({ err }, "Failed to create communication template");
    res.status(500).json({ error: "Could not create communication template" });
  }
});

router.patch("/communication-templates/:templateId", async (req, res): Promise<void> => {
  const id = templateId(req.params.templateId);
  if (!z.uuid().safeParse(id).success) { res.status(400).json({ error: "Invalid template id" }); return; }
  const parsed = communicationTemplatePatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review this template." }); return; }
  try {
    const existing = await db.select().from(communicationTemplates).where(eq(communicationTemplates.id, id)).limit(1);
    if (!existing[0]) { res.status(404).json({ error: "Template not found" }); return; }
    const subjectTemplate = parsed.data.subjectTemplate === undefined ? existing[0].subjectTemplate : parsed.data.subjectTemplate;
    const bodyTemplate = parsed.data.bodyTemplate ?? existing[0].bodyTemplate;
    const allowedPlaceholders = validateCopy(subjectTemplate, bodyTemplate);
    const rows = await db.update(communicationTemplates).set({
      ...parsed.data, allowedPlaceholders,
      state: existing[0].state === "active" ? "reviewed" : existing[0].state,
      reviewedBy: String((req as any).userId ?? "owner"), reviewedAt: new Date(), updatedAt: new Date(),
    }).where(eq(communicationTemplates.id, id)).returning();
    res.json({ template: rows[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update template";
    if (message === "INVALID_TEMPLATE_PLACEHOLDER") { res.status(400).json({ error: "Use only approved template placeholders." }); return; }
    req.log.error({ err }, "Failed to update communication template");
    res.status(500).json({ error: "Could not update communication template" });
  }
});

router.post("/communication-templates/:templateId/activate", async (req, res): Promise<void> => {
  const id = templateId(req.params.templateId);
  if (!z.uuid().safeParse(id).success) { res.status(400).json({ error: "Invalid template id" }); return; }
  const rows = await db.select().from(communicationTemplates).where(eq(communicationTemplates.id, id)).limit(1);
  const template = rows[0];
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  try {
    validateCopy(template.subjectTemplate, template.bodyTemplate);
    const tokenSet = new Set(extractTemplateTokens(`${template.subjectTemplate ?? ""}\n${template.bodyTemplate}`));
    const missingDefinitions = template.requiredPlaceholders.filter((token) => !tokenSet.has(token));
    if (missingDefinitions.length > 0) { res.status(409).json({ error: `Required placeholders are not present in the template: ${missingDefinitions.join(", ")}` }); return; }
    const updated = await db.update(communicationTemplates).set({
      state: "active", reviewedBy: String((req as any).userId ?? "owner"), reviewedAt: new Date(), updatedAt: new Date(),
    }).where(eq(communicationTemplates.id, id)).returning();
    res.json({ template: updated[0] });
  } catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Could not activate template" }); }
});

router.post("/communication-templates/:templateId/archive", async (req, res): Promise<void> => {
  const id = templateId(req.params.templateId);
  if (!z.uuid().safeParse(id).success) { res.status(400).json({ error: "Invalid template id" }); return; }
  const rows = await db.update(communicationTemplates).set({ state: "archived", updatedAt: new Date() })
    .where(eq(communicationTemplates.id, id)).returning();
  if (!rows[0]) { res.status(404).json({ error: "Template not found" }); return; }
  res.json({ template: rows[0] });
});

router.post("/communication-templates/:templateId/promote-shared", async (req, res): Promise<void> => {
  const id = templateId(req.params.templateId);
  if (!z.uuid().safeParse(id).success) { res.status(400).json({ error: "Invalid template id" }); return; }
  try {
    const template = await new CommunicationTemplateRepository(db).promoteToShared(id, String((req as any).userId ?? "owner"));
    res.json({ template });
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "TEMPLATE_NOT_PROMOTABLE") { res.status(409).json({ error: "Only private coordinator templates can be promoted to Shared Office." }); return; }
    req.log.error({ err }, "Failed to promote communication template");
    res.status(500).json({ error: "Could not promote communication template" });
  }
});

router.post("/communication-templates/:templateId/preview", async (req, res): Promise<void> => {
  const id = templateId(req.params.templateId);
  if (!z.uuid().safeParse(id).success) { res.status(400).json({ error: "Invalid template id" }); return; }
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid preview values" }); return; }
  const rows = await db.select().from(communicationTemplates).where(eq(communicationTemplates.id, id)).limit(1);
  const template = rows[0];
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  try {
    const values = Object.fromEntries(Object.entries(parsed.data.values)
      .filter(([key]) => allowedTemplatePlaceholders.includes(key as TemplatePlaceholder)));
    res.json({ preview: renderCommunicationTemplateText({
      templateId: template.id, subjectTemplate: template.subjectTemplate, bodyTemplate: template.bodyTemplate,
      requiredPlaceholders: template.requiredPlaceholders as TemplatePlaceholder[], values,
    }) });
  } catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Could not preview template" }); }
});

export default router;
