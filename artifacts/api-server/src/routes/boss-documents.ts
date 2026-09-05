import { Router, type IRouter } from "express";
import { and, desc, eq, or, ilike } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  bookings,
  contacts,
  designAssets,
  designOutputs,
  designProjects,
  officeEmailDrafts,
  organizations,
} from "@/db/schema";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";
import { GoogleCloudPrivateObjectStorage } from "@/lib/private-object-storage";

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
    const [contractRows, certificateRows, emailRows] = await Promise.all([
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
        id: designAssets.id,
        name: designAssets.name,
        altText: designAssets.altText,
        scope: designAssets.scope,
        mimeType: designAssets.mimeType,
        storageKey: designAssets.storageKey,
        projectId: designAssets.projectId,
        bookingId: designAssets.bookingId,
        bookingName: bookings.name,
        organizationId: designAssets.organizationId,
        organizationName: organizations.name,
        isApproved: designAssets.isApproved,
        createdAt: designAssets.createdAt,
      })
        .from(designAssets)
        .leftJoin(bookings, eq(bookings.id, designAssets.bookingId))
        .leftJoin(organizations, eq(organizations.id, designAssets.organizationId))
        .where(and(
          eq(designAssets.uploadedByAccountId, officeAccountId),
          or(
            ilike(designAssets.name, "%COI%"),
            ilike(designAssets.name, "%certificate of insurance%"),
            ilike(designAssets.name, "%insurance certificate%"),
          ),
        ))
        .orderBy(desc(designAssets.createdAt)),
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
    const certificates = await Promise.all(certificateRows.map(async (row) => ({
      ...row,
      reviewState: row.isApproved ? "reviewed" : "needs_review",
      expirationState: "not_recorded",
      expiresAt: null,
      fileUrl: row.storageKey
        ? await assetStorage.getSignedReadUrl(row.storageKey, 15 * 60).catch(() => null)
        : null,
      storageKey: undefined,
    })));

    res.json({
      contracts,
      certificates,
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

export default router;