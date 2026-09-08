import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  bookings,
  contacts,
  designOutputs,
  designProjects,
  officeEmailDrafts,
  organizations,
} from "@/db/schema";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";
import { GoogleCloudPrivateObjectStorage } from "@/lib/private-object-storage";
import { listCertificateRecords } from "./coi-certificates";
import { createBusinessDocumentsRouter } from "./business-documents";

const router: IRouter = Router();
const requireBoss = createRequireBossMiddleware(new DrizzleBossAccountRepository(db));
const assetStorage = new GoogleCloudPrivateObjectStorage(process.env, [
  "GOOGLE_CLOUD_STORAGE_BUCKET",
  "LEG_MANAGER_RECEIPT_BUCKET",
]);

function contractState(metadata: Record<string, unknown> | null) {
  return typeof metadata?.contractState === "string"
    ? metadata.contractState
    : "prepared";
}

router.get("/boss/documents", requireBoss, async (req, res): Promise<void> => {
  const officeAccountId = req.bossAccount!.studioOfficeAccountId;
  if (!officeAccountId) {
    res.json({
      contracts: [],
      certificates: [],
      emailDrafts: [],
      workspaceAvailable: false,
    });
    return;
  }

  try {
    const [contractRows, emailRows, certificates] = await Promise.all([
      db.select({
        id: designOutputs.id,
        projectId: designProjects.id,
        projectName: designProjects.name,
        projectStatus: designProjects.status,
        outputStatus: designOutputs.status,
        metadata: designOutputs.metadata,
        storageKey: designOutputs.storageKey,
        createdAt: designOutputs.createdAt,
        completedAt: designOutputs.completedAt,
      })
        .from(designOutputs)
        .innerJoin(designProjects, eq(designProjects.id, designOutputs.projectId))
        .where(and(
          eq(designProjects.officeAccountId, officeAccountId),
          eq(designOutputs.outputType, "contract"),
        ))
        .orderBy(desc(designOutputs.createdAt)),
      db.select({
        id: officeEmailDrafts.id,
        organizationId: officeEmailDrafts.organizationId,
        organizationName: organizations.name,
        contactId: officeEmailDrafts.contactId,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
        recipientEmail: officeEmailDrafts.recipientEmail,
        subject: officeEmailDrafts.subject,
        state: officeEmailDrafts.state,
        coordinatorNote: officeEmailDrafts.coordinatorNote,
        ownerReturnNote: officeEmailDrafts.ownerReturnNote,
        submittedAt: officeEmailDrafts.submittedAt,
        sentAt: officeEmailDrafts.sentAt,
        updatedAt: officeEmailDrafts.updatedAt,
      })
        .from(officeEmailDrafts)
        .innerJoin(organizations, eq(organizations.id, officeEmailDrafts.organizationId))
        .innerJoin(contacts, eq(contacts.id, officeEmailDrafts.contactId))
        .where(eq(officeEmailDrafts.officeAccountId, officeAccountId))
        .orderBy(desc(officeEmailDrafts.updatedAt)),
      listCertificateRecords({ officeAccountId }),
    ]);

    const contracts = await Promise.all(contractRows.map(async (row) => ({
      ...row,
      contractState: contractState(row.metadata),
      fileUrl: row.storageKey
        ? await assetStorage.getSignedReadUrl(row.storageKey, 15 * 60).catch(() => null)
        : null,
      metadata: undefined,
      storageKey: undefined,
    })));
    res.json({
      contracts,
      certificates,
      libraryDocuments: certificates.flatMap((certificate) => certificate.documentId ? [{
        documentId: certificate.documentId,
        category: "coi" as const,
        name: certificate.name,
        fileAvailable: certificate.fileAvailable,
      }] : []),
      emailDrafts: emailRows.map((row) => ({
        ...row,
        contactName: `${row.contactFirstName} ${row.contactLastName}`.trim(),
      })),
      workspaceAvailable: true,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to load Boss business documents");
    res.status(500).json({ error: "Could not load business documents." });
  }
});

router.get("/boss/business-documents/profiles", requireBoss, async (req, res): Promise<void> => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!query) {
    res.json({ profiles: [] });
    return;
  }

  try {
    const profiles = await db.select({
      id: organizations.id,
      name: organizations.name,
    })
      .from(organizations)
      .where(ilike(organizations.name, `%${query}%`))
      .orderBy(asc(organizations.name))
      .limit(10);
    res.json({ profiles: profiles.map((profile) => ({ ...profile, city: null, region: null })) });
  } catch (error) {
    req.log.error({ err: error }, "Failed to search profiles for Boss document review");
    res.status(500).json({ error: "Could not search profiles." });
  }
});

// Dave uses Boss authentication but receives the same canonical document routes
// and permissions as the owner document library.
router.use("/boss", requireBoss, createBusinessDocumentsRouter());

export default router;
