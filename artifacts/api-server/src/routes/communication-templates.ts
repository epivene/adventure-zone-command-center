import { eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { emailBuilderDocumentSchema, type EmailBuilderDocument } from "@workspace/api-zod";

import { db } from "@workspace/db";
import { communicationTemplates, officeAccounts } from "@/db/schema";
import { CommunicationTemplateRepository } from "@/features/communication-templates/communication-template-repository";
import { ensureCommunicationTemplateSeed } from "@/features/communication-templates/communication-template-seed";
import { ensureRouteFillOutreachTemplateSeed } from "@/features/communication-templates/route-fill-outreach-template-seed";
import { ensureConventionCampaignTemplateSeed } from "@/features/communication-templates/convention-campaign-template-seed";
import { validateAuthoredTemplateText } from "@/features/communication-templates/communication-template-authoring";
import { BossWorkRequestService, templateFingerprint } from "@/features/boss-work-requests/boss-work-request-service";
import {
  allowedTemplatePlaceholders,
  extractTemplateTokens,
  renderCommunicationTemplateText,
} from "@/features/communication-templates/communication-template-renderer";
import type { TemplatePlaceholder } from "@/features/communication-templates/communication-template-types";
import { prepareCommunicationTemplateWrite, shouldClearEditorDocument } from "@/features/communication-templates/communication-template-write";

const router: IRouter = Router();
const placeholderSchema = z.enum(allowedTemplatePlaceholders);
const bossWorkRequests = new BossWorkRequestService(db);

export const communicationTemplateWriteSchema = z.object({
  code: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(160),
  channel: z.enum(["email", "internal_email"]),
  category: z.string().trim().min(1).max(120),
  subjectTemplate: z.string().max(2000).nullable(),
  bodyTemplate: z.string().trim().min(1).max(100000),
  bodyFormat: z.enum(["plain_text", "html"]).default("plain_text"),
  requiredPlaceholders: z.array(placeholderSchema),
  accessScope: z.enum(["owner", "office"]),
  editorDocument: emailBuilderDocumentSchema.optional(),
}).strict();

const communicationTemplatePatchSchema = communicationTemplateWriteSchema
  .omit({ code: true }).partial()
  // Creation defaults must not change omitted fields on PATCH (Zod 4 applies
  // defaults inside optional fields). Preserve the stored format on body edits.
  .extend({ bodyFormat: z.enum(["plain_text", "html"]).optional() }).strict()
  .refine((value) => Object.keys(value).length > 0, "No template changes provided.");
const previewSchema = z.object({ values: z.record(z.string(), z.string().nullable()).default({}) }).strict();

function validateCopy(subjectTemplate: string | null, bodyTemplate: string) {
  return validateAuthoredTemplateText({ subjectTemplate, bodyTemplate }).placeholders;
}
function templateId(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
async function seed() {
  await ensureCommunicationTemplateSeed(db);
  await ensureRouteFillOutreachTemplateSeed(db);
  await ensureConventionCampaignTemplateSeed(db);
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
    const prepared = prepareCommunicationTemplateWrite({
      bodyTemplate: parsed.data.bodyTemplate,
      bodyFormat: parsed.data.bodyFormat,
      editorDocument: parsed.data.editorDocument as EmailBuilderDocument | undefined,
    });
    const allowedPlaceholders = validateCopy(parsed.data.subjectTemplate, prepared.bodyTemplate);
    const rows = await db.insert(communicationTemplates).values({
      ...parsed.data, ...prepared, allowedPlaceholders, state: "draft", ownerKind: "company",
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
    const prepared = prepareCommunicationTemplateWrite({
      bodyTemplate: parsed.data.bodyTemplate ?? existing[0].bodyTemplate,
      bodyFormat: parsed.data.bodyFormat ?? existing[0].bodyFormat,
      editorDocument: parsed.data.editorDocument as EmailBuilderDocument | undefined,
      clearEditorDocument: shouldClearEditorDocument(parsed.data),
    });
    const allowedPlaceholders = validateCopy(subjectTemplate, prepared.bodyTemplate);
    const rows = await db.update(communicationTemplates).set({
      ...parsed.data, ...prepared, allowedPlaceholders,
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

const requestApprovalSchema = z.object({
  assignedBossAccountId: z.string().uuid(),
  priority: z.enum(["normal", "high", "urgent"]).default("normal"),
  dueAt: z.string().datetime().nullable().optional(),
  instructions: z.string().trim().max(12000).nullable().optional(),
}).strict();

router.post("/communication-templates/convention-review-set", async (req, res): Promise<void> => {
  const parsed = requestApprovalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review this request." });
    return;
  }
  try {
    await seed();
    const detail = await bossWorkRequests.createConventionTemplateReviewSet({
      assignedBossAccountId: parsed.data.assignedBossAccountId,
      priority: parsed.data.priority,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      instructions: parsed.data.instructions,
      ownerId: String((req as any).userId ?? "owner"),
    });
    res.status(201).json(detail);
  } catch (err) {
    const status = err instanceof Error && err.message.includes("not available") ? 404 : 409;
    res.status(status).json({
      error: err instanceof Error ? err.message : "Could not send the convention set for approval.",
    });
  }
});

router.post("/communication-templates/:templateId/request-dave-approval", async (req, res): Promise<void> => {
  const id = templateId(req.params.templateId);
  const parsed = requestApprovalSchema.safeParse(req.body);
  if (!z.uuid().safeParse(id).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid template id" : parsed.error.issues[0]?.message });
    return;
  }
  const template = (await db.select().from(communicationTemplates).where(eq(communicationTemplates.id, id)).limit(1))[0];
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  try {
    validateCopy(template.subjectTemplate, template.bodyTemplate);
    const fingerprint = templateFingerprint({
      templateVersion: template.templateVersion,
      subjectTemplate: template.subjectTemplate,
      bodyTemplate: template.bodyTemplate,
      bodyFormat: template.bodyFormat,
    });
    const detail = await bossWorkRequests.createOwnerRequest({
      type: "email_template_approval",
      assignedBossAccountId: parsed.data.assignedBossAccountId,
      title: `Review email template: ${template.name}`,
      instructions: parsed.data.instructions ?? "Please preview this email and approve it or leave notes for changes.",
      priority: parsed.data.priority,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      deduplicationKey: `template-review:${template.id}:${fingerprint}`,
      templateId: template.id,
      ownerId: String((req as any).userId ?? "owner"),
    });
    res.status(201).json(detail);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Could not send template for approval." });
  }
});

router.post("/communication-templates/:templateId/activate", async (_req, res): Promise<void> => {
  res.status(409).json({ error: "Send this company template to Dave for approval. Approval activates the exact reviewed revision automatically." });
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
      bodyFormat: template.bodyFormat,
      requiredPlaceholders: template.requiredPlaceholders as TemplatePlaceholder[], values,
    }) });
  } catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Could not preview template" }); }
});

export default router;
