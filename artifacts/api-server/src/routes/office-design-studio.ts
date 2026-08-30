import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@workspace/db";
import {
  designAssets,
  designOutputs,
  designProjectVersions,
  designProjects,
  designSmartFields,
  designTemplateFavorites,
  designTemplates,
  type DesignType,
} from "@workspace/db/design-studio-schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { sanitizeDesignStudioCanvas } from "@/features/design-studio/canvas-sanitizer";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { resolveOfficeSession } from "@/features/office/office-middleware";
import { verifyOfficeToken } from "@/features/office/office-auth";
import { verifyToken } from "@/lib/auth";
import { GoogleCloudPrivateObjectStorage } from "@/lib/private-object-storage";
import { officeAccounts } from "@workspace/db/office-coordinator-schema";

const router: IRouter = Router();
const officeRepository = new DrizzleOfficeAccountRepository(db);
const studioAssetStorage = new GoogleCloudPrivateObjectStorage(process.env, [
  "GOOGLE_CLOUD_STORAGE_BUCKET",
  "LEG_MANAGER_RECEIPT_BUCKET",
]);

/**
 * Marketing is owner-authenticated while the Office workspace uses an Office
 * token. Both are valid Studio actors; owner access is mapped to the enabled
 * Office account used for Studio ownership so records remain scoped and
 * auditable instead of using a magic user id.
 */
async function requireStudio(req: any, res: any, next: () => void): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Design Studio authentication required" });
    return;
  }
  const officeContext = await resolveOfficeSession(token, officeRepository);
  if (officeContext) {
    req.officeAccount = officeContext;
    next();
    return;
  }
  if (verifyToken(token)) {
    const [account] = await db
      .select({
        id: officeAccounts.id,
        displayName: officeAccounts.displayName,
        role: officeAccounts.role,
        enabled: officeAccounts.enabled,
        sessionVersion: officeAccounts.sessionVersion,
      })
      .from(officeAccounts)
      .where(eq(officeAccounts.enabled, true))
      .orderBy(asc(officeAccounts.createdAt))
      .limit(1);
    if (account) {
      req.officeAccount = {
        accountId: account.id,
        displayName: account.displayName,
        role: "office_coordinator",
      };
      next();
      return;
    }
  }
  res.status(401).json({ error: "Design Studio authentication is invalid or expired" });
}

const typeValues = [
  "flyer",
  "social_post",
  "email",
  "brochure",
  "review_request",
  "contract",
  "blank",
] as const;
const typeSchema = z.enum(typeValues);
const projectIdSchema = z.string().uuid();
const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    type: z
      .string()
      .transform((value) => value.trim().toLowerCase().replaceAll(" ", "_"))
      .pipe(typeSchema),
    content: z.string().max(200000).optional(),
    notes: z.string().max(20000).nullable().optional(),
    linkedOrganizationId: z.string().uuid().nullable().optional(),
    linkedContactId: z.string().uuid().nullable().optional(),
    linkedBookingId: z.string().uuid().nullable().optional(),
  })
  .strict();
const patchProjectSchema = createProjectSchema.partial().extend({
  status: z.enum(["draft", "ready"]).optional(),
  canvas: z.record(z.string(), z.unknown()).nullable().optional(),
  syncState: z.enum(["synced", "pending", "failed"]).optional(),
});
const duplicateSchema = z
  .object({ name: z.string().trim().min(1).max(160).optional() })
  .strict();
const outputSchema = z
  .object({
    outputType: z.enum([
      "preview",
      "export",
      "gmail_draft",
      "review_request",
      "contract",
    ]),
    versionId: z.string().uuid().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const contractSignSchema = z
  .object({
    signerRole: z.enum(["organizer", "david"]),
    note: z.string().max(2000).optional(),
  })
  .strict();
const voidSchema = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
const assetSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    scope: z.enum(["company", "package", "project", "event", "profile"]),
    storageKey: z.string().max(1000).nullable().optional(),
    mimeType: z.string().max(160).nullable().optional(),
    sizeBytes: z.string().max(40).nullable().optional(),
    altText: z.string().max(500).nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    organizationId: z.string().uuid().nullable().optional(),
    bookingId: z.string().uuid().nullable().optional(),
  })
  .strict();
const smartFieldSchema = z
  .object({
    fieldKey: z.string().trim().min(1).max(120),
    sourceType: z.enum(["event", "profile", "booking", "package"]),
    sourceId: z.string().uuid().nullable().optional(),
    valueSnapshot: z.string().max(20000).nullable().optional(),
    state: z.enum(["current", "overridden", "outdated", "unresolved"]).optional(),
    overriddenValue: z.string().max(20000).nullable().optional(),
    sourceUpdatedAt: z.string().datetime().nullable().optional(),
  })
  .strict();

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function uiType(type: string): string {
  return type.replaceAll("_", " ");
}

function projectJson(project: typeof designProjects.$inferSelect) {
  return {
    ...project,
    type: uiType(project.type),
    updatedAt: project.updatedAt.toISOString(),
    createdAt: project.createdAt.toISOString(),
    archivedAt: project.archivedAt?.toISOString() ?? null,
  };
}

async function ownedProject(id: string, accountId: string) {
  const [project] = await db
    .select()
    .from(designProjects)
    .where(
      and(eq(designProjects.id, id), eq(designProjects.officeAccountId, accountId)),
    )
    .limit(1);
  return project ?? null;
}

async function nextVersionNumber(projectId: string): Promise<string> {
  const [latest] = await db
    .select({ versionNumber: designProjectVersions.versionNumber })
    .from(designProjectVersions)
    .where(eq(designProjectVersions.projectId, projectId))
    .orderBy(desc(designProjectVersions.createdAt))
    .limit(1);
  const parsed = Number(latest?.versionNumber?.replace(/^v/, ""));
  return `v${Number.isFinite(parsed) ? parsed + 1 : 1}`;
}

async function snapshotProject(
  project: typeof designProjects.$inferSelect,
  accountId: string,
  status: "draft" | "ready" = "draft",
) {
  const versionNumber = await nextVersionNumber(project.id);
  const [version] = await db
    .insert(designProjectVersions)
    .values({
      projectId: project.id,
      versionNumber,
      content: project.content,
      notes: project.notes,
      canvas: project.canvas,
      status,
      createdByAccountId: accountId,
    })
    .returning();
  return version;
}

async function seedTemplates() {
  const existing = await db
    .select({ id: designTemplates.id })
    .from(designTemplates)
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(designTemplates).values([
    { name: "Adventure flyer", type: "flyer", description: "A bold, print-ready event promotion.", tags: ["event", "print"], visibility: "approved", isApproved: true, lockedContent: { brand: true } },
    { name: "Social story", type: "social_post", description: "A quick, warm update for your next story.", tags: ["social"], visibility: "approved", isApproved: true, lockedContent: { brand: true } },
    { name: "Family email", type: "email", description: "A useful, welcoming message for families.", tags: ["email"], visibility: "approved", isApproved: true, lockedContent: { footer: true } },
    { name: "Review request", type: "review_request", description: "Invite guests to share their experience.", tags: ["reviews"], visibility: "approved", isApproved: true, lockedContent: { legal: true } },
    { name: "Agreement outline", type: "contract", description: "A protected contract starting point.", tags: ["legal"], visibility: "approved", isApproved: true, lockedContent: { legal: true } },
  ]);
}

router.get("/office/design-studio/projects", requireStudio, async (req, res): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  try {
    const filters = [
      eq(designProjects.officeAccountId, req.officeAccount!.accountId),
      status ? eq(designProjects.status, status as never) : undefined,
      search
        ? or(
            ilike(designProjects.name, `%${search}%`),
            ilike(designProjects.type, `%${search.replaceAll(" ", "_")}%`),
          )
        : undefined,
    ].filter(Boolean);
    const projects = await db
      .select()
      .from(designProjects)
      .where(and(...filters))
      .orderBy(desc(designProjects.updatedAt));
    res.json({ projects: projects.map(projectJson) });
  } catch (err) {
    req.log.error({ err }, "Failed to list Design Studio projects");
    res.status(500).json({ error: "Could not load Design Studio projects." });
  }
});

router.post("/office/design-studio/projects", requireStudio, async (req, res): Promise<void> => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the project details." });
    return;
  }
  try {
    const [project] = await db
      .insert(designProjects)
      .values({
        officeAccountId: req.officeAccount!.accountId,
        name: parsed.data.name,
        type: parsed.data.type as DesignType,
        content: parsed.data.content ?? "",
        notes: parsed.data.notes ?? null,
        linkedOrganizationId: parsed.data.linkedOrganizationId ?? null,
        linkedContactId: parsed.data.linkedContactId ?? null,
        linkedBookingId: parsed.data.linkedBookingId ?? null,
      })
      .returning();
    if (!project) throw new Error("Design project was not created.");
    await snapshotProject(project, req.officeAccount!.accountId);
    await recordAuditEntry(db, {
      entityType: "design_project",
      entityId: project.id,
      action: "created",
      before: null,
      after: { name: project.name, type: project.type, status: project.status },
    });
    res.status(201).json(projectJson(project));
  } catch (err) {
    req.log.error({ err }, "Failed to create Design Studio project");
    res.status(500).json({ error: "Could not create the Design Studio project." });
  }
});

router.get("/office/design-studio/projects/:projectId", requireStudio, async (req, res): Promise<void> => {
  const id = routeParam(req.params.projectId);
  if (!projectIdSchema.safeParse(id).success) {
    res.status(400).json({ error: "Invalid project ID." });
    return;
  }
  try {
    const project = await ownedProject(id, req.officeAccount!.accountId);
    if (!project) {
      res.status(404).json({ error: "Design project not found." });
      return;
    }
    const [versions, smartFields, assets, outputs] = await Promise.all([
      db.select().from(designProjectVersions).where(eq(designProjectVersions.projectId, id)).orderBy(desc(designProjectVersions.createdAt)),
      db.select().from(designSmartFields).where(eq(designSmartFields.projectId, id)).orderBy(asc(designSmartFields.fieldKey)),
      db.select().from(designAssets).where(eq(designAssets.projectId, id)).orderBy(desc(designAssets.createdAt)),
      db.select().from(designOutputs).where(eq(designOutputs.projectId, id)).orderBy(desc(designOutputs.createdAt)),
    ]);
    res.json({
      project: projectJson(project),
      versions,
      smartFields,
      assets,
      outputs,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load Design Studio project");
    res.status(500).json({ error: "Could not load the Design Studio project." });
  }
});

router.patch("/office/design-studio/projects/:projectId", requireStudio, async (req, res): Promise<void> => {
  const id = routeParam(req.params.projectId);
  const parsed = patchProjectSchema.safeParse(req.body);
  if (!projectIdSchema.safeParse(id).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid project ID." : parsed.error.issues[0]?.message ?? "Review the project changes." });
    return;
  }
  try {
    const project = await ownedProject(id, req.officeAccount!.accountId);
    if (!project) {
      res.status(404).json({ error: "Design project not found." });
      return;
    }
    if (project.status === "archived" || project.status === "used" || project.status === "sent") {
      res.status(409).json({ error: "Historical Design Studio projects are read-only. Duplicate it to make changes." });
      return;
    }
    const [updated] = await db
      .update(designProjects)
      .set({
        ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
        ...(parsed.data.type === undefined ? {} : { type: parsed.data.type as DesignType }),
        ...(parsed.data.content === undefined ? {} : { content: parsed.data.content }),
        ...(parsed.data.notes === undefined ? {} : { notes: parsed.data.notes }),
        ...(parsed.data.canvas === undefined
          ? {}
          : { canvas: parsed.data.canvas === null ? null : sanitizeDesignStudioCanvas(parsed.data.canvas) }),
        ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
        ...(parsed.data.syncState === undefined ? {} : { syncState: parsed.data.syncState }),
        updatedAt: new Date(),
      })
      .where(eq(designProjects.id, id))
      .returning();
    if (!updated) throw new Error("Design project was not updated.");
    await snapshotProject(updated, req.officeAccount!.accountId, updated.status === "ready" ? "ready" : "draft");
    await recordAuditEntry(db, {
      entityType: "design_project",
      entityId: id,
      action: "updated",
      before: { name: project.name, type: project.type, status: project.status },
      after: { name: updated.name, type: updated.type, status: updated.status },
    });
    res.json(projectJson(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to update Design Studio project");
    res.status(500).json({ error: "Could not save the Design Studio project." });
  }
});

router.delete("/office/design-studio/projects/:projectId", requireStudio, async (req, res): Promise<void> => {
  const id = routeParam(req.params.projectId);
  if (!projectIdSchema.safeParse(id).success) {
    res.status(400).json({ error: "Invalid project ID." });
    return;
  }
  try {
    const project = await ownedProject(id, req.officeAccount!.accountId);
    if (!project) {
      res.status(404).json({ error: "Design project not found." });
      return;
    }
    const [archived] = await db.update(designProjects).set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() }).where(eq(designProjects.id, id)).returning();
    await recordAuditEntry(db, { entityType: "design_project", entityId: id, action: "archived", before: { status: project.status }, after: { status: "archived" } });
    res.json({ ok: true, project: archived ? projectJson(archived) : null });
  } catch (err) {
    req.log.error({ err }, "Failed to archive Design Studio project");
    res.status(500).json({ error: "Could not archive the Design Studio project." });
  }
});

router.post("/office/design-studio/projects/:projectId/reopen", requireStudio, async (req, res): Promise<void> => {
  const id = routeParam(req.params.projectId);
  try {
    const project = await ownedProject(id, req.officeAccount!.accountId);
    if (!project) { res.status(404).json({ error: "Design project not found." }); return; }
    const [reopened] = await db.update(designProjects).set({ status: "draft", archivedAt: null, updatedAt: new Date() }).where(eq(designProjects.id, id)).returning();
    res.json(reopened ? projectJson(reopened) : null);
  } catch (err) {
    req.log.error({ err }, "Failed to reopen Design Studio project");
    res.status(500).json({ error: "Could not reopen the Design Studio project." });
  }
});

router.post("/office/design-studio/projects/:projectId/duplicate", requireStudio, async (req, res): Promise<void> => {
  const id = routeParam(req.params.projectId);
  const parsed = duplicateSchema.safeParse(req.body);
  if (!projectIdSchema.safeParse(id).success || !parsed.success) { res.status(400).json({ error: "Review the project copy." }); return; }
  try {
    const original = await ownedProject(id, req.officeAccount!.accountId);
    if (!original) { res.status(404).json({ error: "Design project not found." }); return; }
    const [copy] = await db.insert(designProjects).values({
      officeAccountId: req.officeAccount!.accountId,
      name: parsed.data.name ?? `${original.name} copy`,
      type: original.type,
      content: original.content,
      notes: original.notes,
      canvas: original.canvas,
      linkedOrganizationId: original.linkedOrganizationId,
      linkedContactId: original.linkedContactId,
      linkedBookingId: original.linkedBookingId,
    }).returning();
    if (!copy) throw new Error("Design project copy was not created.");
    await snapshotProject(copy, req.officeAccount!.accountId);
    res.status(201).json(projectJson(copy));
  } catch (err) {
    req.log.error({ err }, "Failed to duplicate Design Studio project");
    res.status(500).json({ error: "Could not duplicate the Design Studio project." });
  }
});

router.post("/office/design-studio/projects/:projectId/repurpose", requireStudio, async (req, res): Promise<void> => {
  const id = routeParam(req.params.projectId);
  const parsed = duplicateSchema.safeParse(req.body);
  if (!projectIdSchema.safeParse(id).success || !parsed.success) { res.status(400).json({ error: "Review the repurpose request." }); return; }
  try {
    const original = await ownedProject(id, req.officeAccount!.accountId);
    if (!original) { res.status(404).json({ error: "Design project not found." }); return; }
    const [copy] = await db.insert(designProjects).values({
      officeAccountId: req.officeAccount!.accountId,
      name: parsed.data.name ?? `${original.name} — repurposed`,
      type: original.type,
      content: original.content,
      notes: original.notes,
      canvas: original.canvas,
      linkedOrganizationId: original.linkedOrganizationId,
      linkedContactId: original.linkedContactId,
      linkedBookingId: original.linkedBookingId,
    }).returning();
    if (!copy) throw new Error("Repurposed project was not created.");
    await snapshotProject(copy, req.officeAccount!.accountId);
    await recordAuditEntry(db, { entityType: "design_project", entityId: copy.id, action: "repurposed", before: { sourceProjectId: original.id }, after: { sourceProjectId: original.id, name: copy.name } });
    res.status(201).json(projectJson(copy));
  } catch (err) {
    req.log.error({ err }, "Failed to repurpose Design Studio project");
    res.status(500).json({ error: "Could not repurpose the Design Studio project." });
  }
});

router.post("/office/design-studio/projects/:projectId/outputs", requireStudio, async (req, res): Promise<void> => {
  const id = routeParam(req.params.projectId);
  const parsed = outputSchema.safeParse(req.body);
  if (!projectIdSchema.safeParse(id).success || !parsed.success) { res.status(400).json({ error: "Review the output request." }); return; }
  try {
    const project = await ownedProject(id, req.officeAccount!.accountId);
    if (!project) { res.status(404).json({ error: "Design project not found." }); return; }
    const unresolved = await db
      .select({ fieldKey: designSmartFields.fieldKey, state: designSmartFields.state })
      .from(designSmartFields)
      .where(and(eq(designSmartFields.projectId, id), or(eq(designSmartFields.state, "unresolved"), eq(designSmartFields.state, "outdated"))));
    if (unresolved.length > 0 && parsed.data.outputType !== "preview") {
      res.status(409).json({ error: "Resolve outdated or missing smart fields before producing this output.", unresolvedFields: unresolved });
      return;
    }
    const version = parsed.data.versionId
      ? (await db.select().from(designProjectVersions).where(and(eq(designProjectVersions.id, parsed.data.versionId), eq(designProjectVersions.projectId, id))).limit(1))[0]
      : (await db.select().from(designProjectVersions).where(eq(designProjectVersions.projectId, id)).orderBy(desc(designProjectVersions.createdAt)).limit(1))[0];
    if (!version) { res.status(409).json({ error: "Create a saved version before producing an output." }); return; }
    const [frozen] = await db.update(designProjectVersions).set({ isImmutable: true, frozenAt: new Date(), status: parsed.data.outputType === "contract" ? "ready" : version.status }).where(eq(designProjectVersions.id, version.id)).returning();
    const [output] = await db.insert(designOutputs).values({
      projectId: id,
      versionId: frozen?.id ?? version.id,
      createdByAccountId: req.officeAccount!.accountId,
      outputType: parsed.data.outputType,
      status: "ready",
      metadata: { ...(parsed.data.metadata ?? {}), handoffOnly: parsed.data.outputType === "gmail_draft", historicalVersion: frozen?.versionNumber ?? version.versionNumber },
      completedAt: new Date(),
    }).returning();
    if (!output) throw new Error("Output was not created.");
    await recordAuditEntry(db, { entityType: "design_output", entityId: output.id, action: `created_${parsed.data.outputType}`, before: null, after: { projectId: id, versionId: output.versionId, status: output.status } });
    res.status(201).json(output);
  } catch (err) {
    req.log.error({ err }, "Failed to create Design Studio output");
    res.status(500).json({ error: "Could not prepare that output." });
  }
});

router.post("/office/design-studio/projects/:projectId/contract/prepare", requireStudio, async (req, res): Promise<void> => {
  const id = routeParam(req.params.projectId);
  if (!projectIdSchema.safeParse(id).success) { res.status(400).json({ error: "Invalid project ID." }); return; }
  try {
    const project = await ownedProject(id, req.officeAccount!.accountId);
    if (!project || project.type !== "contract") { res.status(404).json({ error: "Contract project not found." }); return; }
    const [version] = await db.select().from(designProjectVersions).where(eq(designProjectVersions.projectId, id)).orderBy(desc(designProjectVersions.createdAt)).limit(1);
    if (!version) { res.status(409).json({ error: "Save the contract before preparing it for signature." }); return; }
    const [frozen] = await db.update(designProjectVersions).set({ isImmutable: true, frozenAt: new Date(), status: "ready" }).where(eq(designProjectVersions.id, version.id)).returning();
    const [output] = await db.insert(designOutputs).values({
      projectId: id,
      versionId: frozen?.id ?? version.id,
      createdByAccountId: req.officeAccount!.accountId,
      outputType: "contract",
      status: "ready",
      metadata: { contractState: "sent_for_organizer_signature", handoffOnly: true, historicalVersion: frozen?.versionNumber ?? version.versionNumber },
      completedAt: new Date(),
    }).returning();
    if (!output) throw new Error("Contract output was not created.");
    await recordAuditEntry(db, { entityType: "design_output", entityId: output.id, action: "contract_prepared_for_signature", before: null, after: { projectId: id, versionId: output.versionId, contractState: "sent_for_organizer_signature" } });
    res.status(201).json(output);
  } catch (err) {
    req.log.error({ err }, "Failed to prepare Design Studio contract");
    res.status(500).json({ error: "Could not prepare the contract for signature." });
  }
});

router.post("/office/design-studio/outputs/:outputId/sign", requireStudio, async (req, res): Promise<void> => {
  const outputId = routeParam(req.params.outputId);
  const parsed = contractSignSchema.safeParse(req.body);
  if (!projectIdSchema.safeParse(outputId).success || !parsed.success) { res.status(400).json({ error: "Review the signature details." }); return; }
  try {
    const [output] = await db.select({ output: designOutputs, project: designProjects }).from(designOutputs).innerJoin(designProjects, eq(designProjects.id, designOutputs.projectId)).where(and(eq(designOutputs.id, outputId), eq(designProjects.officeAccountId, req.officeAccount!.accountId))).limit(1);
    if (!output || output.output.outputType !== "contract") { res.status(404).json({ error: "Contract output not found." }); return; }
    if (output.output.status === "void") { res.status(409).json({ error: "Voided contract outputs cannot be signed." }); return; }
    const metadata = (output.output.metadata ?? {}) as Record<string, unknown>;
    const state = typeof metadata.contractState === "string" ? metadata.contractState : "sent_for_organizer_signature";
    if (parsed.data.signerRole === "organizer" && state !== "sent_for_organizer_signature") { res.status(409).json({ error: "The organizer signature has already been recorded." }); return; }
    if (parsed.data.signerRole === "david" && state !== "awaiting_david_countersign") { res.status(409).json({ error: "David can countersign only after the organizer signs." }); return; }
    const nextState = parsed.data.signerRole === "organizer" ? "awaiting_david_countersign" : "signed";
    const signatures = Array.isArray(metadata.signatures) ? metadata.signatures : [];
    const nextMetadata = { ...metadata, contractState: nextState, signatures: [...signatures, { signerRole: parsed.data.signerRole, signedAt: new Date().toISOString(), note: parsed.data.note ?? null }] };
    const [updated] = await db.update(designOutputs).set({ metadata: nextMetadata, completedAt: nextState === "signed" ? new Date() : output.output.completedAt }).where(eq(designOutputs.id, outputId)).returning();
    if (nextState === "signed") await db.update(designProjects).set({ status: "used", updatedAt: new Date() }).where(eq(designProjects.id, output.output.projectId));
    await recordAuditEntry(db, { entityType: "design_output", entityId: outputId, action: `contract_${parsed.data.signerRole}_signed`, before: { contractState: state }, after: { contractState: nextState } });
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to record Design Studio signature");
    res.status(500).json({ error: "Could not record that signature." });
  }
});

router.post("/office/design-studio/outputs/:outputId/void", requireStudio, async (req, res): Promise<void> => {
  const outputId = routeParam(req.params.outputId);
  const parsed = voidSchema.safeParse(req.body);
  if (!projectIdSchema.safeParse(outputId).success || !parsed.success) { res.status(400).json({ error: "A reason is required to void an output." }); return; }
  try {
    const [output] = await db.select({ output: designOutputs, project: designProjects }).from(designOutputs).innerJoin(designProjects, eq(designProjects.id, designOutputs.projectId)).where(and(eq(designOutputs.id, outputId), eq(designProjects.officeAccountId, req.officeAccount!.accountId))).limit(1);
    if (!output) { res.status(404).json({ error: "Design output not found." }); return; }
    const metadata = (output.output.metadata ?? {}) as Record<string, unknown>;
    const [voided] = await db.update(designOutputs).set({ status: "void", metadata: { ...metadata, voidReason: parsed.data.reason, voidedAt: new Date().toISOString() } }).where(eq(designOutputs.id, outputId)).returning();
    await recordAuditEntry(db, { entityType: "design_output", entityId: outputId, action: "voided", before: { status: output.output.status }, after: { status: "void", reason: parsed.data.reason } });
    res.json(voided);
  } catch (err) {
    req.log.error({ err }, "Failed to void Design Studio output");
    res.status(500).json({ error: "Could not void that output." });
  }
});

router.get("/office/design-studio/templates", requireStudio, async (req, res): Promise<void> => {
  try {
    await seedTemplates();
    const templates = await db.select().from(designTemplates).orderBy(asc(designTemplates.name));
    const favorites = await db.select({ templateId: designTemplateFavorites.templateId }).from(designTemplateFavorites).where(eq(designTemplateFavorites.accountId, req.officeAccount!.accountId));
    const favoriteIds = new Set(favorites.map((item) => item.templateId));
    res.json({ templates: templates.map((template) => ({ ...template, type: uiType(template.type), tags: template.tags ?? [], isFavorite: favoriteIds.has(template.id) })) });
  } catch (err) {
    req.log.error({ err }, "Failed to list Design Studio templates");
    res.status(500).json({ error: "Could not load Design Studio templates." });
  }
});

router.post("/office/design-studio/templates/:templateId/favorite", requireStudio, async (req, res): Promise<void> => {
  const templateId = routeParam(req.params.templateId);
  try {
    const current = await db.select().from(designTemplateFavorites).where(and(eq(designTemplateFavorites.accountId, req.officeAccount!.accountId), eq(designTemplateFavorites.templateId, templateId))).limit(1);
    if (current.length > 0) {
      await db.delete(designTemplateFavorites).where(and(eq(designTemplateFavorites.accountId, req.officeAccount!.accountId), eq(designTemplateFavorites.templateId, templateId)));
      res.json({ isFavorite: false });
    } else {
      await db.insert(designTemplateFavorites).values({ accountId: req.officeAccount!.accountId, templateId });
      res.json({ isFavorite: true });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to favorite Design Studio template");
    res.status(500).json({ error: "Could not update that template favorite." });
  }
});

router.get("/office/design-studio/assets", requireStudio, async (req, res): Promise<void> => {
  try {
    const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;
    const permittedAssets = or(
      eq(designAssets.uploadedByAccountId, req.officeAccount!.accountId),
      and(
        or(eq(designAssets.scope, "company"), eq(designAssets.scope, "package")),
        eq(designAssets.isApproved, true),
      ),
    );
    const assets = await db
      .select()
      .from(designAssets)
      .where(scope ? and(permittedAssets, eq(designAssets.scope, scope as never)) : permittedAssets)
      .orderBy(desc(designAssets.createdAt));
    const addressableAssets = await Promise.all(assets.map(async (asset) => ({
      ...asset,
      url: asset.storageKey
        ? await studioAssetStorage.getSignedReadUrl(asset.storageKey, 15 * 60).catch(() => null)
        : null,
    })));
    res.json({ assets: addressableAssets });
  } catch (err) {
    req.log.error({ err }, "Failed to list Design Studio assets");
    res.status(500).json({ error: "Could not load the Brand Library." });
  }
});

router.post("/office/design-studio/assets", requireStudio, async (req, res): Promise<void> => {
  const parsed = assetSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the asset details." }); return; }
  try {
    if (parsed.data.scope === "company" || parsed.data.scope === "package") {
      res.status(403).json({ error: "Only approved library managers can change company and package assets." });
      return;
    }
    const [asset] = await db.insert(designAssets).values({ ...parsed.data, uploadedByAccountId: req.officeAccount!.accountId }).returning();
    res.status(201).json(asset);
  } catch (err) {
    req.log.error({ err }, "Failed to create Design Studio asset");
    res.status(500).json({ error: "Could not save that asset." });
  }
});

router.put("/office/design-studio/projects/:projectId/smart-fields/:fieldKey", requireStudio, async (req, res): Promise<void> => {
  const projectId = routeParam(req.params.projectId);
  const fieldKey = routeParam(req.params.fieldKey);
  const parsed = smartFieldSchema.safeParse({ ...req.body, fieldKey });
  if (!projectIdSchema.safeParse(projectId).success || !parsed.success) { res.status(400).json({ error: "Review the smart field." }); return; }
  try {
    const project = await ownedProject(projectId, req.officeAccount!.accountId);
    if (!project) { res.status(404).json({ error: "Design project not found." }); return; }
    const [field] = await db.insert(designSmartFields).values({
      projectId,
      fieldKey: parsed.data.fieldKey,
      sourceType: parsed.data.sourceType,
      sourceId: parsed.data.sourceId ?? null,
      valueSnapshot: parsed.data.valueSnapshot ?? null,
      state: parsed.data.state ?? "current",
      overriddenValue: parsed.data.overriddenValue ?? null,
      sourceUpdatedAt: parsed.data.sourceUpdatedAt ? new Date(parsed.data.sourceUpdatedAt) : null,
      updatedAt: new Date(),
    }).onConflictDoUpdate({ target: [designSmartFields.projectId, designSmartFields.fieldKey], set: {
      sourceType: parsed.data.sourceType,
      sourceId: parsed.data.sourceId ?? null,
      valueSnapshot: parsed.data.valueSnapshot ?? null,
      state: parsed.data.state ?? "current",
      overriddenValue: parsed.data.overriddenValue ?? null,
      sourceUpdatedAt: parsed.data.sourceUpdatedAt ? new Date(parsed.data.sourceUpdatedAt) : null,
      updatedAt: new Date(),
    }}).returning();
    res.json(field);
  } catch (err) {
    req.log.error({ err }, "Failed to save Design Studio smart field");
    res.status(500).json({ error: "Could not save that smart field." });
  }
});

export default router;