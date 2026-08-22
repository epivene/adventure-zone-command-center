import { Router, type IRouter } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { createRequireOfficeMiddleware } from "@/features/office/office-middleware";
import { DrizzlePackageIntelligenceSettingsRepository } from "@/features/packages/package-intelligence-settings";
import { CommunicationTemplateRepository } from "@/features/communication-templates/communication-template-repository";
import { ensureCommunicationTemplateSeed } from "@/features/communication-templates/communication-template-seed";
import { renderCommunicationTemplate } from "@/features/communication-templates/communication-template-service";
import {
  allowedTemplatePlaceholders,
  type TemplatePlaceholder,
} from "@/features/communication-templates/communication-template-types";

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

router.get("/office/communication-templates", requireOffice, async (req, res): Promise<void> => {
  try {
    await ensureCommunicationTemplateSeed(db);
    const [records, packages] = await Promise.all([
      new CommunicationTemplateRepository(db).list({
        state: "active",
        accessScope: "office",
      }),
      activePackages(),
    ]);
    res.json({
      templates: records.map((template) => ({
        id: template.id,
        code: template.code,
        name: template.name,
        category: template.category,
        subjectTemplate: template.subjectTemplate,
        requiredPlaceholders: template.requiredPlaceholders,
      })),
      packages,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list Office communication templates");
    res.status(500).json({ error: "Could not load email templates." });
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
    await ensureCommunicationTemplateSeed(db);
    const repository = new CommunicationTemplateRepository(db);
    const template = await repository.getById(templateId);
    if (!template || template.state !== "active" || template.accessScope !== "office") {
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
