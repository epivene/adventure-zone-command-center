import { Router, type IRouter } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { createRequireOfficeMiddleware } from "@/features/office/office-middleware";
import { DrizzlePackageIntelligenceSettingsRepository } from "@/features/packages/package-intelligence-settings";
import { CommunicationTemplateRepository } from "@/features/communication-templates/communication-template-repository";
import { ensureCommunicationTemplateSeed } from "@/features/communication-templates/communication-template-seed";
import { ensureRouteFillOutreachTemplateSeed } from "@/features/communication-templates/route-fill-outreach-template-seed";
import { renderCommunicationTemplate } from "@/features/communication-templates/communication-template-service";
import {
  allowedTemplatePlaceholders,
  type TemplatePlaceholder,
} from "@/features/communication-templates/communication-template-types";
import {
  canOfficeMutateTemplate,
  canOfficeUseTemplate,
} from "@/features/communication-templates/communication-template-permissions";

const router: IRouter = Router();
const requireOffice = createRequireOfficeMiddleware(new DrizzleOfficeAccountRepository(db));
const uuid = z.string().uuid();
const allowedExtraKeys = new Set<string>(allowedTemplatePlaceholders);

const renderSchema = z
  .object({
    organizationId: uuid,
    contactId: uuid,
    packageTemplateId: uuid.nullable().optional(),
    values: z.record(z.string(), z.string().nullable()).optional(),
  })
  .strict();

const authorSchema = z.object({
  name: z.string().trim().min(1).max(160),
  subjectTemplate: z.string().max(500).nullable(),
  bodyTemplate: z.string().trim().min(1).max(50000),
}).strict();

const duplicateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
}).strict();

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

type PackageChoice = { id: string; code: string; name: string };

async function activePackages(): Promise<PackageChoice[]> {
  const records = await new DrizzlePackageIntelligenceSettingsRepository(
    db,
  ).listPackageTemplates();
  return records
    .filter((record) => record.active)
    .map(({ id, code, name }) => ({ id, code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function seedTemplates(): Promise<void> {
  await ensureCommunicationTemplateSeed(db);
  await ensureRouteFillOutreachTemplateSeed(db);
}

function templateMutationError(res: any, err: unknown): boolean {
  const code = err instanceof Error ? err.message : "";
  if (code === "INVALID_TEMPLATE_PLACEHOLDER") {
    res.status(400).json({ error: "Use only the protected template fields provided by the editor." });
    return true;
  }
  if (code === "TEMPLATE_NOT_MUTABLE") {
    res.status(403).json({ error: "You can only edit your own private templates." });
    return true;
  }
  if (code === "TEMPLATE_NOT_AVAILABLE") {
    res.status(404).json({ error: "That template is not available." });
    return true;
  }
  return false;
}

router.get("/office/communication-templates", requireOffice, async (req, res): Promise<void> => {
  try {
    await seedTemplates();
    const repository = new CommunicationTemplateRepository(db);
    const [records, packages] = await Promise.all([
      repository.listForOffice(req.officeAccount!.accountId),
      activePackages(),
    ]);
    res.json({
      templates: records.map((template) => ({
        id: template.id,
        code: template.code,
        name: template.name,
        category: template.category,
        subjectTemplate: template.subjectTemplate,
        bodyTemplate: template.bodyTemplate,
        requiredPlaceholders: template.requiredPlaceholders,
        ownerKind: template.ownerKind,
        editableByOffice: canOfficeMutateTemplate(template, req.officeAccount!.accountId),
        sourceTemplateId: template.sourceTemplateId,
      })),
      packages,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list Office communication templates");
    res.status(500).json({ error: "Could not load email templates." });
  }
});

router.post("/office/communication-templates", requireOffice, async (req, res): Promise<void> => {
  const parsed = authorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the template." });
    return;
  }
  try {
    const template = await new CommunicationTemplateRepository(db).createPrivateForOffice(
      req.officeAccount!.accountId,
      parsed.data,
    );
    res.status(201).json({ template });
  } catch (err) {
    if (templateMutationError(res, err)) return;
    req.log.error({ err }, "Failed to create private Office template");
    res.status(500).json({ error: "Could not save the template." });
  }
});

router.patch("/office/communication-templates/:templateId", requireOffice, async (req, res): Promise<void> => {
  const templateId = routeParam(req.params.templateId);
  const parsed = authorSchema.safeParse(req.body);
  if (!uuid.safeParse(templateId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid template ID." : parsed.error.issues[0]?.message ?? "Review the template." });
    return;
  }
  try {
    const template = await new CommunicationTemplateRepository(db).updatePrivateForOffice(
      templateId,
      req.officeAccount!.accountId,
      parsed.data,
    );
    res.json({ template });
  } catch (err) {
    if (templateMutationError(res, err)) return;
    req.log.error({ err }, "Failed to update private Office template");
    res.status(500).json({ error: "Could not update the template." });
  }
});

router.post("/office/communication-templates/:templateId/archive", requireOffice, async (req, res): Promise<void> => {
  const templateId = routeParam(req.params.templateId);
  if (!uuid.safeParse(templateId).success) {
    res.status(400).json({ error: "Invalid template ID." });
    return;
  }
  try {
    const template = await new CommunicationTemplateRepository(db).archivePrivateForOffice(
      templateId,
      req.officeAccount!.accountId,
    );
    res.json({ template });
  } catch (err) {
    if (templateMutationError(res, err)) return;
    req.log.error({ err }, "Failed to archive private Office template");
    res.status(500).json({ error: "Could not archive the template." });
  }
});

router.post("/office/communication-templates/:templateId/duplicate", requireOffice, async (req, res): Promise<void> => {
  const templateId = routeParam(req.params.templateId);
  const parsed = duplicateSchema.safeParse(req.body);
  if (!uuid.safeParse(templateId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid template ID." : parsed.error.issues[0]?.message ?? "Review the template copy." });
    return;
  }
  try {
    const template = await new CommunicationTemplateRepository(db).duplicateForOffice(
      templateId,
      req.officeAccount!.accountId,
      parsed.data,
    );
    res.status(201).json({ template });
  } catch (err) {
    if (templateMutationError(res, err)) return;
    req.log.error({ err }, "Failed to duplicate Office template");
    res.status(500).json({ error: "Could not copy the template." });
  }
});

router.post("/office/communication-templates/:templateId/render", requireOffice, async (req, res): Promise<void> => {
  const templateId = routeParam(req.params.templateId);
  const parsed = renderSchema.safeParse(req.body);
  if (!uuid.safeParse(templateId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid template ID." : parsed.error.issues[0]?.message ?? "Review the template details." });
    return;
  }

  try {
    await seedTemplates();
    const repository = new CommunicationTemplateRepository(db);
    const template = await repository.getById(templateId);
    if (!template || !canOfficeUseTemplate(template, req.officeAccount!.accountId)) {
      res.status(404).json({ error: "Email template not found." });
      return;
    }

    const values = Object.fromEntries(
      Object.entries(parsed.data.values ?? {}).filter(([key]) => allowedExtraKeys.has(key)),
    ) as Partial<Record<TemplatePlaceholder, string | null>>;

    let packageTemplateId = parsed.data.packageTemplateId ?? null;
    if (!packageTemplateId && template.code === "mini_zone_option") {
      const mini = (await activePackages()).find((pkg) => pkg.code === "mini_zone");
      packageTemplateId = mini?.id ?? null;
    }

    const rendered = await renderCommunicationTemplate(db, {
      templateId,
      organizationId: parsed.data.organizationId,
      contactId: parsed.data.contactId,
      packageTemplateId,
      sender: {
        name: req.officeAccount!.displayName,
        phone: null,
        email: null,
      },
      extraValues: values,
    });
    res.json({ rendered });
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (["TEMPLATE_NOT_FOUND", "ORGANIZATION_NOT_FOUND", "CONTACT_NOT_FOUND", "PACKAGE_NOT_FOUND"].includes(code)) {
      res.status(404).json({ error: "The selected profile, contact, package, or template is no longer available." });
      return;
    }
    req.log.error({ err }, "Failed to render Office communication template");
    res.status(500).json({ error: "Could not prepare the email template." });
  }
});

export default router;
