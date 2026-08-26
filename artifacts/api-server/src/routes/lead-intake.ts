import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { contacts, organizationContacts, organizations } from "@/db/schema";

import { importLeadWorkbookSchema, leadImportActor, leadReviewConfirmationSchema } from "@/features/lead-intake/lead-intake-input";
import { LeadIntakeRepository } from "@/features/lead-intake/lead-intake-repository";
import { ActProfileEvidenceRepository } from "@/features/lead-intake/act-profile-evidence-repository";
import { createLeadProfileEvidenceHandler } from "@/features/lead-intake/lead-profile-evidence-handler";
import { LeadReviewService, LeadReviewServiceError } from "@/features/lead-intake/lead-review-service";
import { LeadRelationshipEvidenceRepository } from "@/features/lead-intake/lead-relationship-evidence-repository";
import { LeadAvailabilityService, LeadAvailabilityServiceError } from "@/features/lead-intake/lead-availability-service";
import { LeadAvailabilityRepository } from "@/features/lead-intake/lead-availability-repository";
import { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";

const router: IRouter = Router();
const repository = new LeadIntakeRepository(db);
const profileEvidenceRepository = new ActProfileEvidenceRepository(db);
const reviewService = new LeadReviewService(db);
const googleConnectionRepository = new PostgresGoogleConnectionRepository();
const availabilityRepository = new LeadAvailabilityRepository(db);

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
    }
    if (((error as { code?: string }).code || (error instanceof Error ? error.message : "")) === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED" || (error as { code?: string }).code === "GOOGLE_REAUTHORIZATION_REQUIRED") {
      res.status(409).json({ error: "Google Calendar authorization must be renewed before checking availability.", code: "GOOGLE_REAUTHORIZATION_REQUIRED" });
      return;
    }
    req.log.error({ error }, "Failed to check lead availability from Google Calendar");
    res.status(503).json({ error: "Google Calendar could not be checked.", code: "GOOGLE_CALENDAR_UNAVAILABLE" });
  }
});

export default router;
