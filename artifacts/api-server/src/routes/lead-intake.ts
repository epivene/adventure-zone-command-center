import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { contacts, leadImportRows, organizationContacts, organizations } from "@/db/schema";

import { importLeadWorkbookSchema, leadImportActor, leadReviewConfirmationSchema } from "@/features/lead-intake/lead-intake-input";
import { LeadIntakeRepository } from "@/features/lead-intake/lead-intake-repository";
import { ActProfileEvidenceRepository } from "@/features/lead-intake/act-profile-evidence-repository";
import { createLeadProfileEvidenceHandler } from "@/features/lead-intake/lead-profile-evidence-handler";
import { LeadReviewService, LeadReviewServiceError } from "@/features/lead-intake/lead-review-service";
import { LeadRelationshipEvidenceRepository } from "@/features/lead-intake/lead-relationship-evidence-repository";
import { LeadAvailabilityService, LeadAvailabilityServiceError } from "@/features/lead-intake/lead-availability-service";
import { LeadAvailabilityRepository } from "@/features/lead-intake/lead-availability-repository";
import { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";
import { CommunicationBlockRepository } from "@/features/lead-intake/communication-block-repository";
import { LeadEmailPreviewService } from "@/features/lead-intake/lead-email-preview-service";
import { LeadEmailPreviewRepository } from "@/features/lead-intake/lead-email-preview-repository";
import { createLeadEmailPreviewHandler } from "@/features/lead-intake/lead-email-preview-handler";

const router: IRouter = Router();
const repository = new LeadIntakeRepository(db);
const profileEvidenceRepository = new ActProfileEvidenceRepository(db);
const reviewService = new LeadReviewService(db);
const googleConnectionRepository = new PostgresGoogleConnectionRepository();
const availabilityRepository = new LeadAvailabilityRepository(db);
const communicationBlockRepository = new CommunicationBlockRepository(db);
const leadEmailPreviewService = new LeadEmailPreviewService(
  new LeadEmailPreviewRepository(db),
);

async function optionalGoogleReadClient() {
  try {
    return await googleConnectionRepository.createReadClient();
  } catch {
    return undefined;
  }
}

async function createLeadAvailabilityService() {
  const google = await googleConnectionRepository.createReadClient();
  if (!google?.listCalendarEvents) {
    throw Object.assign(new Error("Google Calendar is not connected for availability checks."), { code: "GOOGLE_REAUTHORIZATION_REQUIRED" });
  }
  return new LeadAvailabilityService({ persistence: availabilityRepository, google: google as Required<Pick<typeof google, "listCalendarEvents">> });
}

async function createRelationshipReviewService() {
  const google = await optionalGoogleReadClient();
  return new LeadReviewService(db, new LeadRelationshipEvidenceRepository(db, google ?? undefined));
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

router.post("/lead-intake/imports", async (req, res): Promise<void> => {
  const parsed = importLeadWorkbookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The spreadsheet import is invalid.", issues: parsed.error.issues });
    return;
  }
  try {
    const result = await repository.importWorkbook({
      ...parsed.data,
      importedBy: leadImportActor((req as any).userId),
    });
    res.status(result.reused ? 200 : 201).json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to persist lead spreadsheet import");
    res.status(500).json({ error: "Could not import the spreadsheet for review." });
  }
});

router.get("/lead-intake/imports", async (_req, res): Promise<void> => {
  res.json({ batches: await repository.listBatches() });
});

router.get("/lead-intake/imports/:batchId", async (req, res): Promise<void> => {
  const batchId = param(req.params.batchId);
  if (!isUuid(batchId)) {
    res.status(400).json({ error: "Invalid lead import batch." });
    return;
  }
  const batch = await repository.getBatch(batchId);
  if (!batch) {
    res.status(404).json({ error: "Lead import batch not found." });
    return;
  }
  res.json({ batch });
});

router.get("/lead-intake/organizations/:organizationId/contacts", async (req, res): Promise<void> => {
  const organizationId = param(req.params.organizationId);
  if (!isUuid(organizationId)) {
    res.status(400).json({ error: "Invalid profile." });
    return;
  }
  const rows = await db.select({
    id: contacts.id,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    email: contacts.email,
    jobTitle: contacts.jobTitle,
    role: organizationContacts.role,
  }).from(organizationContacts)
    .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
    .innerJoin(organizations, eq(organizations.id, organizationContacts.organizationId))
    .where(and(
      eq(organizationContacts.organizationId, organizationId),
      eq(organizationContacts.active, true),
      isNull(organizations.consolidatedIntoId),
    ));
  res.json({ contacts: rows });
});

router.get(
  "/lead-intake/organizations/:organizationId/evidence",
  createLeadProfileEvidenceHandler(profileEvidenceRepository),
);

router.post("/lead-intake/rows/:rowId/confirm", async (req, res): Promise<void> => {
  const rowId = param(req.params.rowId);
  const parsed = leadReviewConfirmationSchema.safeParse(req.body);
  if (!isUuid(rowId) || !parsed.success) {
    res.status(400).json({ error: "Review the event, contact, recipient, dates, and evidence." });
    return;
  }
  try {
    const result = await reviewService.confirm({
      rowId,
      expectedVersion: parsed.data.expectedVersion,
      reviewedBy: leadImportActor((req as any).userId),
      decision: parsed.data.decision,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof LeadReviewServiceError) {
      if (error.code === "ROW_NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.code === "VERSION_CONFLICT") {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.code === "REVIEW_BLOCKED") {
        res.status(422).json({ error: error.message, blockers: error.blockers });
        return;
      }
    }
    req.log.error({ error }, "Failed to confirm lead review");
    res.status(500).json({ error: "Could not save the verified lead." });
  }
});

router.post("/lead-intake/rows/:rowId/classify-relationship", async (req, res): Promise<void> => {
  const rowId = param(req.params.rowId);
  const expectedVersion = req.body?.expectedVersion;
  if (!isUuid(rowId) || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
    res.status(400).json({ error: "A valid lead row and review version are required." });
    return;
  }
  try {
    const relationshipService = await createRelationshipReviewService();
    const result = await relationshipService.classifyRelationship({
      rowId,
      expectedVersion,
      reviewedBy: leadImportActor((req as any).userId),
    });
    res.json(result);
  } catch (error) {
    if (error instanceof LeadReviewServiceError) {
      if (error.code === "ROW_NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.code === "VERSION_CONFLICT") {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.code === "RELATIONSHIP_NOT_READY" || error.code === "REVIEW_BLOCKED") {
        res.status(422).json({ error: error.message });
        return;
      }
    }
    req.log.error({ error }, "Failed to classify previous contact for lead review");
    res.status(500).json({ error: "Could not check previous contact for this lead." });
  }
});

router.get("/lead-intake/rows/:rowId/relationship-evidence", async (req, res): Promise<void> => {
  const rowId = param(req.params.rowId);
  if (!isUuid(rowId)) {
    res.status(400).json({ error: "A valid lead row is required." });
    return;
  }
  try {
    const relationshipService = await createRelationshipReviewService();
    const evidence = await relationshipService.listRelationshipEvidence({ rowId });
    res.json({ evidence });
  } catch (error) {
    if (error instanceof LeadReviewServiceError) {
      if (error.code === "ROW_NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.code === "RELATIONSHIP_NOT_READY") {
        res.status(422).json({ error: error.message });
        return;
      }
    }
    req.log.error({ error }, "Failed to load previous-contact evidence for lead review");
    res.status(500).json({ error: "Could not load previous-contact evidence for this lead." });
  }
});

router.post("/lead-intake/rows/:rowId/check-availability", async (req, res): Promise<void> => {
  const rowId = param(req.params.rowId);
  const expectedVersion = req.body?.expectedVersion;
  if (!isUuid(rowId) || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
    res.status(400).json({ error: "A valid lead row and review version are required." });
    return;
  }
  try {
    const availabilityService = await createLeadAvailabilityService();
    const result = await availabilityService.check({
      rowId,
      expectedVersion,
      checkedBy: leadImportActor((req as any).userId),
    });
    res.json(result);
  } catch (error) {
    if (error instanceof LeadAvailabilityServiceError) {
      if (error.code === "ROW_NOT_FOUND") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.code === "VERSION_CONFLICT") {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error.code === "AVAILABILITY_NOT_READY") {
        res.status(422).json({ error: error.message });
        return;
      }
      if (error.code === "GOOGLE_REAUTHORIZATION_REQUIRED") {
        res.status(409).json({ error: error.message, code: error.code });
        return;
      }
      if (error.code === "GOOGLE_CALENDAR_UNAVAILABLE") {
        res.status(503).json({ error: error.message, code: error.code });
        return;
      }
      if (error.code === "AVAILABILITY_PERSISTENCE_FAILED") {
        req.log.error({ error }, "Failed to persist lead availability snapshot");
        res.status(500).json({ error: error.message, code: error.code });
        return;
      }
    }
    if (((error as { code?: string }).code || (error instanceof Error ? error.message : "")) === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED" || (error as { code?: string }).code === "GOOGLE_REAUTHORIZATION_REQUIRED") {
      res.status(409).json({ error: "Google Calendar authorization must be renewed before checking availability.", code: "GOOGLE_REAUTHORIZATION_REQUIRED" });
      return;
    }
    req.log.error({ error }, "Failed to check lead availability");
    res.status(500).json({ error: "Lead availability could not be recorded.", code: "AVAILABILITY_PERSISTENCE_FAILED" });
  }
});

router.post("/lead-intake/rows/:rowId/review-status", async (req, res): Promise<void> => {
  const rowId = param(req.params.rowId); const body = req.body ?? {};
  const territory = body.territoryStatus; const fit = body.fitStatus;
  if (!isUuid(rowId) || !Number.isInteger(body.expectedVersion)
    || !["open", "ask_amy_dave", "closed", "licensing_issue", "needs_review"].includes(territory)
    || !["approved", "needs_review", "not_a_fit"].includes(fit)) {
    res.status(400).json({ error: "Use explicit territory and fit review statuses." }); return;
  }
  const [updated] = await db.update(leadImportRows).set({ territoryStatus: territory, fitStatus: fit, reviewVersion: body.expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(leadImportRows.id, rowId), eq(leadImportRows.reviewVersion, body.expectedVersion))).returning({ reviewVersion: leadImportRows.reviewVersion, territoryStatus: leadImportRows.territoryStatus, fitStatus: leadImportRows.fitStatus });
  if (!updated) { res.status(409).json({ error: "This lead changed in another review. Reload it before saving." }); return; }
  res.json({ rowId, ...updated });
});

router.get("/lead-intake/rows/:rowId/email-preview", createLeadEmailPreviewHandler(leadEmailPreviewService));

router.get("/lead-intake/communication-blocks", async (_req, res): Promise<void> => {
  res.json({ blocks: await communicationBlockRepository.list() });
});

router.get("/lead-intake/communication-blocks/:blockId/history", async (req, res): Promise<void> => {
  const blockId = param(req.params.blockId);
  if (!isUuid(blockId)) { res.status(400).json({ error: "Invalid communication block." }); return; }
  res.json({ events: await communicationBlockRepository.history(blockId) });
});

router.post("/lead-intake/communication-blocks", async (req, res): Promise<void> => {
  const body = req.body ?? {};
  const targetType = body.targetType;
  const validEmail = typeof body.normalizedEmail === "string" && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(body.normalizedEmail.trim());
  const exact = (type: string, key?: string) => targetType === type && Object.entries({ organizationId: body.organizationId, contactId: body.contactId, normalizedEmail: body.normalizedEmail, rowId: body.rowId }).every(([name, value]) => name === key ? Boolean(value) : !value);
  if (!String(body.reason ?? "").trim()
    || !(exact("organization", "organizationId") && isUuid(body.organizationId)
      || exact("contact", "contactId") && isUuid(body.contactId)
      || exact("lead_import_row", "rowId") && isUuid(body.rowId)
      || exact("recipient_email", "normalizedEmail") && validEmail
      || exact("internal_preview"))) {
    res.status(400).json({ error: "Use one valid exact target that matches the communication-block target type." }); return;
  }
  if (targetType === "organization" && !(await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, body.organizationId)).limit(1))[0]) { res.status(404).json({ error: "Profile not found." }); return; }
  if (targetType === "contact" && !(await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, body.contactId)).limit(1))[0]) { res.status(404).json({ error: "Contact not found." }); return; }
  if (targetType === "lead_import_row" && !(await db.select({ id: leadImportRows.id }).from(leadImportRows).where(eq(leadImportRows.id, body.rowId)).limit(1))[0]) { res.status(404).json({ error: "Lead source row not found." }); return; }
  try {
    const block = await communicationBlockRepository.create({ targetType, organizationId: body.organizationId ?? null, contactId: body.contactId ?? null, normalizedEmail: validEmail ? body.normalizedEmail.trim().toLowerCase() : null, rowId: body.rowId ?? null, reason: String(body.reason).trim(), actorId: leadImportActor((req as any).userId) });
    res.status(201).json({ block });
  } catch (error) { req.log.error({ error }, "Failed to create communication block"); res.status(500).json({ error: "Could not create communication block." }); }
});

router.post("/lead-intake/communication-blocks/:blockId/remove", async (req, res): Promise<void> => {
  const blockId = param(req.params.blockId);
  if (!isUuid(blockId) || !String(req.body?.reason ?? "").trim()) { res.status(400).json({ error: "A block ID and removal reason are required." }); return; }
  try {
    const block = await communicationBlockRepository.remove(blockId, { actorId: leadImportActor((req as any).userId), reason: String(req.body.reason).trim() });
    if (!block) { res.status(404).json({ error: "Communication block not found." }); return; }
    res.json({ block });
  } catch (error) { req.log.error({ error }, "Failed to remove communication block"); res.status(500).json({ error: "Could not remove communication block." }); }
});

router.delete("/lead-intake/communication-blocks/:blockId", async (req, res): Promise<void> => {
  const blockId = param(req.params.blockId);
  if (!isUuid(blockId) || !String(req.body?.reason ?? "").trim()) { res.status(400).json({ error: "A block ID and removal reason are required." }); return; }
  try {
    const block = await communicationBlockRepository.remove(blockId, { actorId: leadImportActor((req as any).userId), reason: String(req.body.reason).trim() });
    if (!block) { res.status(404).json({ error: "Communication block not found." }); return; }
    res.json({ block });
  } catch (error) { req.log.error({ error }, "Failed to remove communication block"); res.status(500).json({ error: "Could not remove communication block." }); }
});

export default router;
