import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  bookings,
  contacts,
  contractAgreements,
  contractProviderEvents,
  designOutputs,
  designProjects,
  designProjectVersions,
  designTemplates,
  organizationContacts,
  organizations,
  type ContractState,
} from "@/db/schema";
import { AdobeSignClient } from "@/features/contracts/adobe-sign-client";
import { readAdobeSignConfig } from "@/features/contracts/adobe-sign-config";
import { renderContractPdf } from "@/features/contracts/contract-pdf";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { GoogleCloudPrivateObjectStorage } from "@/lib/private-object-storage";
import { requireStudio } from "./office-design-studio";

const router: IRouter = Router();
const uuid = z.string().uuid();
const createSchema = z.object({
  contactId: uuid,
  bookingId: uuid.nullable().optional(),
  templateId: uuid.nullable().optional(),
}).strict();
const cancelSchema = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
const adobe = new AdobeSignClient();
const storage = new GoogleCloudPrivateObjectStorage(process.env, [
  "GOOGLE_CLOUD_STORAGE_BUCKET",
  "LEG_MANAGER_RECEIPT_BUCKET",
]);

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function agreementJson(row: typeof contractAgreements.$inferSelect) {
  return {
    ...row,
    providerAgreementId: row.providerAgreementId?.startsWith("sending:") ? null : row.providerAgreementId,
    signedPdfAvailable: Boolean(row.signedPdfStorageKey),
    auditTrailAvailable: Boolean(row.auditTrailStorageKey),
    signedPdfStorageKey: undefined,
    auditTrailStorageKey: undefined,
  };
}

function adobeState(status: string, eventType = ""): ContractState {
  const normalized = status.toUpperCase();
  if (normalized === "SIGNED" || normalized === "APPROVED") return "completed";
  if (normalized === "REJECTED") return "declined";
  if (normalized === "CANCELLED" || normalized === "ABORTED") return "cancelled";
  if (normalized === "EXPIRED") return "expired";
  if (/PARTICIPANT|SIGNER|ACTION_COMPLETED/.test(eventType.toUpperCase())) return "countersign_pending";
  return "pending_customer";
}

async function persistCompletedFiles(agreement: typeof contractAgreements.$inferSelect) {
  if (!agreement.providerAgreementId || agreement.providerAgreementId.startsWith("sending:")) return;
  const [pdf, audit] = await Promise.all([
    adobe.signedPdf(agreement.providerAgreementId),
    adobe.auditTrail(agreement.providerAgreementId),
  ]);
  const pdfKey = `contracts/${agreement.id}/signed.pdf`;
  const auditKey = `contracts/${agreement.id}/audit-trail.pdf`;
  await Promise.all([
    storage.put(pdfKey, pdf, "application/pdf"),
    storage.put(auditKey, audit, "application/pdf"),
  ]);
  await db.update(contractAgreements).set({
    signedPdfStorageKey: pdfKey,
    auditTrailStorageKey: auditKey,
    updatedAt: new Date(),
  }).where(eq(contractAgreements.id, agreement.id));
  await db.update(designOutputs).set({
    storageKey: pdfKey,
    status: "ready",
    completedAt: new Date(),
  }).where(eq(designOutputs.id, agreement.outputId));
}

async function applyProviderState(
  agreement: typeof contractAgreements.$inferSelect,
  nextState: ContractState,
  providerStatus: string,
) {
  const now = new Date();
  const [updated] = await db.update(contractAgreements).set({
    state: nextState,
    customerSignedAt: nextState === "countersign_pending" && !agreement.customerSignedAt ? now : agreement.customerSignedAt,
    countersignPendingAt: nextState === "countersign_pending" && !agreement.countersignPendingAt ? now : agreement.countersignPendingAt,
    completedAt: nextState === "completed" ? now : agreement.completedAt,
    terminalAt: ["completed", "declined", "cancelled", "expired"].includes(nextState) ? now : agreement.terminalAt,
    failureCode: null,
    failureDetails: null,
    updatedAt: now,
  }).where(eq(contractAgreements.id, agreement.id)).returning();
  if (updated) {
    await db.update(designOutputs).set({
      metadata: { contractState: nextState, provider: "adobe_sign", providerStatus },
      status: nextState === "failed" ? "failed" : nextState === "cancelled" ? "void" : "ready",
      completedAt: nextState === "completed" ? now : undefined,
    }).where(eq(designOutputs.id, updated.outputId));
    if (nextState === "completed") {
      await db.update(designProjects).set({ status: "used", updatedAt: now }).where(eq(designProjects.id, updated.projectId));
      await persistCompletedFiles(updated);
    }
  }
  return updated;
}

router.get("/office/contracts/readiness", requireStudio, (_req, res) => {
  res.json(readAdobeSignConfig().readiness);
});

router.get("/office/profiles/:profileId/contracts", requireStudio, async (req, res): Promise<void> => {
  const profileId = param(req.params.profileId);
  if (!uuid.safeParse(profileId).success) { res.status(400).json({ error: "Invalid profile ID." }); return; }
  const rows = await db.select().from(contractAgreements)
    .where(eq(contractAgreements.organizationId, profileId))
    .orderBy(desc(contractAgreements.updatedAt));
  res.json({ agreements: rows.map(agreementJson) });
});

router.post("/office/profiles/:profileId/contracts", requireStudio, async (req, res): Promise<void> => {
  const profileId = param(req.params.profileId);
  const parsed = createSchema.safeParse(req.body);
  if (!uuid.safeParse(profileId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid profile ID." : parsed.error.issues[0]?.message ?? "Review the contract details." });
    return;
  }
  try {
    const [organization] = await db.select().from(organizations).where(eq(organizations.id, profileId)).limit(1);
    const [contact] = await db.select({ contact: contacts })
      .from(organizationContacts)
      .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
      .where(and(
        eq(organizationContacts.organizationId, profileId),
        eq(organizationContacts.contactId, parsed.data.contactId),
        eq(organizationContacts.active, true),
      )).limit(1);
    const [booking] = parsed.data.bookingId
      ? await db.select().from(bookings).where(and(eq(bookings.id, parsed.data.bookingId), eq(bookings.organizationId, profileId))).limit(1)
      : [];
    if (!organization || !contact) { res.status(404).json({ error: "Profile or selected contact not found." }); return; }
    if (parsed.data.bookingId && !booking) { res.status(400).json({ error: "That booking is not linked to this profile." }); return; }
    if (!contact.contact.email?.trim()) { res.status(400).json({ error: "The selected customer contact needs an email address." }); return; }
    const [template] = parsed.data.templateId
      ? await db.select().from(designTemplates).where(and(eq(designTemplates.id, parsed.data.templateId), eq(designTemplates.type, "contract"), eq(designTemplates.isApproved, true))).limit(1)
      : await db.select().from(designTemplates).where(and(eq(designTemplates.type, "contract"), eq(designTemplates.isApproved, true))).orderBy(desc(designTemplates.updatedAt)).limit(1);
    const customerName = `${contact.contact.firstName} ${contact.contact.lastName}`.trim();
    const content = [
      template?.content?.trim() || "Adventure Zone Event Services Agreement",
      `Customer: ${customerName}`,
      `Customer email: ${contact.contact.email.trim().toLowerCase()}`,
      `Organization: ${organization.name}`,
      booking ? `Event: ${booking.name}` : "",
      booking?.startsAt ? `Event date: ${booking.startsAt.toISOString()}` : "",
      "",
      "Review and complete the agreement terms before preparing this version for signature.",
    ].filter(Boolean).join("\n");
    const result = await db.transaction(async (transaction) => {
      const [project] = await transaction.insert(designProjects).values({
        officeAccountId: req.officeAccount!.accountId,
        name: `${organization.name} Agreement`,
        type: "contract",
        content,
        notes: "Created from customer profile for Acrobat Sign review.",
        linkedOrganizationId: profileId,
        linkedContactId: contact.contact.id,
        linkedBookingId: booking?.id ?? null,
      }).returning();
      if (!project) throw new Error("CONTRACT_PROJECT_CREATE_FAILED");
      const [version] = await transaction.insert(designProjectVersions).values({
        projectId: project.id,
        versionNumber: "v1",
        content,
        notes: project.notes,
        canvas: project.canvas,
        status: "draft",
        createdByAccountId: req.officeAccount!.accountId,
      }).returning();
      return { project, version };
    });
    await recordAuditEntry(db, {
      entityType: "design_project",
      entityId: result.project.id,
      action: "contract_created_from_profile",
      before: null,
      after: { organizationId: profileId, contactId: contact.contact.id, bookingId: booking?.id ?? null, versionId: result.version?.id },
    });
    res.status(201).json({ project: result.project });
  } catch (error) {
    req.log.error({ err: error }, "Failed to create contract from profile");
    res.status(500).json({ error: "Could not create the contract." });
  }
});

router.get("/office/design-studio/projects/:projectId/contracts", requireStudio, async (req, res): Promise<void> => {
  const projectId = param(req.params.projectId);
  const rows = await db.select({ agreement: contractAgreements })
    .from(contractAgreements)
    .innerJoin(designProjects, eq(designProjects.id, contractAgreements.projectId))
    .where(and(eq(contractAgreements.projectId, projectId), eq(designProjects.officeAccountId, req.officeAccount!.accountId)))
    .orderBy(desc(contractAgreements.createdAt));
  res.json({ agreements: rows.map(({ agreement }) => agreementJson(agreement)), readiness: adobe.readiness() });
});

router.post("/office/design-studio/projects/:projectId/contract/prepare", requireStudio, async (req, res): Promise<void> => {
  const projectId = param(req.params.projectId);
  try {
    const [project] = await db.select().from(designProjects).where(and(eq(designProjects.id, projectId), eq(designProjects.officeAccountId, req.officeAccount!.accountId))).limit(1);
    if (!project || project.type !== "contract") { res.status(404).json({ error: "Contract project not found." }); return; }
    if (!project.linkedOrganizationId || !project.linkedContactId) { res.status(409).json({ error: "Create this contract from a profile before preparing it." }); return; }
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, project.linkedContactId)).limit(1);
    const [organization] = await db.select().from(organizations).where(eq(organizations.id, project.linkedOrganizationId)).limit(1);
    const [booking] = project.linkedBookingId ? await db.select().from(bookings).where(eq(bookings.id, project.linkedBookingId)).limit(1) : [];
    if (!contact?.email?.trim() || !organization) { res.status(409).json({ error: "The linked customer contact needs a valid email address." }); return; }
    const [version] = await db.select().from(designProjectVersions).where(eq(designProjectVersions.projectId, projectId)).orderBy(desc(designProjectVersions.createdAt)).limit(1);
    if (!version) { res.status(409).json({ error: "Save the contract before preparing it." }); return; }
    const [existing] = await db.select().from(contractAgreements).where(and(eq(contractAgreements.projectId, projectId), eq(contractAgreements.versionId, version.id))).limit(1);
    if (existing) { res.json({ agreement: agreementJson(existing), readiness: adobe.readiness() }); return; }
    const config = readAdobeSignConfig();
    const customerName = `${contact.firstName} ${contact.lastName}`.trim();
    const pdf = renderContractPdf({
      title: project.name,
      organizationName: organization.name,
      customerName,
      customerEmail: contact.email.trim().toLowerCase(),
      bookingName: booking?.name,
      content: version.content,
    });
    const replacedAgreementId = project.notes?.match(/Replacement for agreement ([0-9a-f-]{36})\./i)?.[1] ?? null;
    const result = await db.transaction(async (transaction) => {
      const [frozen] = await transaction.update(designProjectVersions).set({ isImmutable: true, frozenAt: new Date(), status: "ready" }).where(eq(designProjectVersions.id, version.id)).returning();
      const [output] = await transaction.insert(designOutputs).values({
        projectId,
        versionId: frozen?.id ?? version.id,
        createdByAccountId: req.officeAccount!.accountId,
        outputType: "contract",
        status: "ready",
        metadata: { contractState: "ready", provider: "adobe_sign", historicalVersion: frozen?.versionNumber ?? version.versionNumber },
      }).returning();
      if (!output) throw new Error("CONTRACT_OUTPUT_CREATE_FAILED");
      const [agreement] = await transaction.insert(contractAgreements).values({
        projectId,
        outputId: output.id,
        versionId: output.versionId,
        organizationId: project.linkedOrganizationId!,
        contactId: project.linkedContactId!,
        bookingId: project.linkedBookingId,
        createdByAccountId: req.officeAccount!.accountId,
        replacedAgreementId,
        state: "ready",
        customerName,
        customerEmail: contact.email!.trim().toLowerCase(),
        davidName: config.davidName,
        davidEmail: config.davidEmail || "Not configured",
      }).returning();
      return { output, agreement };
    });
    if (!result.agreement) throw new Error("CONTRACT_AGREEMENT_CREATE_FAILED");
    const storageKey = `contracts/${result.agreement.id}/prepared.pdf`;
    await storage.put(storageKey, pdf, "application/pdf").then(
      () => db.update(designOutputs).set({ storageKey }).where(eq(designOutputs.id, result.output.id)),
      () => undefined,
    );
    await recordAuditEntry(db, { entityType: "contract_agreement", entityId: result.agreement.id, action: "prepared", before: null, after: { projectId, versionId: result.agreement.versionId } });
    res.status(201).json({ agreement: agreementJson(result.agreement), readiness: adobe.readiness() });
  } catch (error) {
    req.log.error({ err: error }, "Failed to prepare contract");
    res.status(500).json({ error: "Could not prepare the contract." });
  }
});

router.post("/office/contracts/:agreementId/send", requireStudio, async (req, res): Promise<void> => {
  const agreementId = param(req.params.agreementId);
  if (!adobe.readiness().signApiAvailable) { res.status(409).json({ error: adobe.readiness().reason, readiness: adobe.readiness() }); return; }
  const [row] = await db.select({ agreement: contractAgreements, project: designProjects, version: designProjectVersions })
    .from(contractAgreements)
    .innerJoin(designProjects, eq(designProjects.id, contractAgreements.projectId))
    .innerJoin(designProjectVersions, eq(designProjectVersions.id, contractAgreements.versionId))
    .where(and(eq(contractAgreements.id, agreementId), eq(designProjects.officeAccountId, req.officeAccount!.accountId))).limit(1);
  if (!row) { res.status(404).json({ error: "Contract agreement not found." }); return; }
  if (row.agreement.providerAgreementId && !row.agreement.providerAgreementId.startsWith("sending:")) { res.json({ agreement: agreementJson(row.agreement) }); return; }
  if (!["ready", "failed"].includes(row.agreement.state)) { res.status(409).json({ error: "This agreement can no longer be sent." }); return; }
  const claim = `sending:${agreementId}`;
  const [claimed] = await db.update(contractAgreements).set({ providerAgreementId: claim, state: "ready", updatedAt: new Date() })
    .where(and(eq(contractAgreements.id, agreementId), or(isNull(contractAgreements.providerAgreementId), eq(contractAgreements.providerAgreementId, claim)), inArray(contractAgreements.state, ["ready", "failed"]))).returning();
  if (!claimed) { res.status(409).json({ error: "This agreement is already being sent." }); return; }
  try {
    const currentConfig = readAdobeSignConfig();
    const [organization] = await db.select().from(organizations).where(eq(organizations.id, claimed.organizationId)).limit(1);
    const [booking] = claimed.bookingId ? await db.select().from(bookings).where(eq(bookings.id, claimed.bookingId)).limit(1) : [];
    const pdf = renderContractPdf({ title: row.project.name, organizationName: organization?.name ?? "", customerName: claimed.customerName, customerEmail: claimed.customerEmail, bookingName: booking?.name, content: row.version.content });
    const created = await adobe.createAgreement({
      name: row.project.name,
      message: "Please review and sign this Adventure Zone agreement. David will countersign after you.",
      customerName: claimed.customerName,
      customerEmail: claimed.customerEmail,
      davidName: currentConfig.davidName,
      davidEmail: currentConfig.davidEmail,
      pdf,
    });
    const now = new Date();
    const [sent] = await db.update(contractAgreements).set({ providerAgreementId: created.id, state: "pending_customer", davidName: currentConfig.davidName, davidEmail: currentConfig.davidEmail, sentAt: now, failedAt: null, failureCode: null, failureDetails: null, updatedAt: now }).where(and(eq(contractAgreements.id, agreementId), eq(contractAgreements.providerAgreementId, claim))).returning();
    await db.update(designOutputs).set({ metadata: { contractState: "pending_customer", provider: "adobe_sign", providerAgreementId: created.id } }).where(eq(designOutputs.id, claimed.outputId));
    res.json({ agreement: sent ? agreementJson(sent) : null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Acrobat Sign send failed.";
    await db.update(contractAgreements).set({ providerAgreementId: null, state: "failed", failedAt: new Date(), failureCode: "send_failed", failureDetails: message.slice(0, 2000), updatedAt: new Date() }).where(and(eq(contractAgreements.id, agreementId), eq(contractAgreements.providerAgreementId, claim)));
    req.log.error({ err: error, agreementId }, "Failed to send Acrobat Sign agreement");
    res.status(502).json({ error: message });
  }
});

router.post("/office/contracts/:agreementId/refresh", requireStudio, async (req, res): Promise<void> => {
  const agreementId = param(req.params.agreementId);
  const [agreement] = await db.select({ agreement: contractAgreements }).from(contractAgreements)
    .innerJoin(designProjects, eq(designProjects.id, contractAgreements.projectId))
    .where(and(eq(contractAgreements.id, agreementId), eq(designProjects.officeAccountId, req.officeAccount!.accountId))).limit(1);
  if (!agreement?.agreement.providerAgreementId) { res.status(409).json({ error: "This agreement has not been sent to Acrobat Sign." }); return; }
  try {
    const provider = await adobe.getAgreement(agreement.agreement.providerAgreementId);
    const updated = await applyProviderState(agreement.agreement, adobeState(provider.status), provider.status);
    res.json({ agreement: updated ? agreementJson(updated) : null });
  } catch (error) {
    req.log.error({ err: error }, "Failed to refresh Acrobat Sign agreement");
    res.status(502).json({ error: error instanceof Error ? error.message : "Could not refresh Acrobat Sign." });
  }
});

router.post("/office/contracts/:agreementId/cancel", requireStudio, async (req, res): Promise<void> => {
  const agreementId = param(req.params.agreementId);
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Add a cancellation reason." }); return; }
  const [row] = await db.select({ agreement: contractAgreements }).from(contractAgreements)
    .innerJoin(designProjects, eq(designProjects.id, contractAgreements.projectId))
    .where(and(eq(contractAgreements.id, agreementId), eq(designProjects.officeAccountId, req.officeAccount!.accountId))).limit(1);
  if (!row) { res.status(404).json({ error: "Contract agreement not found." }); return; }
  if (row.agreement.providerAgreementId && !row.agreement.providerAgreementId.startsWith("sending:")) await adobe.cancelAgreement(row.agreement.providerAgreementId, parsed.data.reason);
  const now = new Date();
  const [cancelled] = await db.update(contractAgreements).set({ state: "cancelled", terminalAt: now, failureDetails: parsed.data.reason, updatedAt: now }).where(eq(contractAgreements.id, agreementId)).returning();
  await db.update(designOutputs).set({ status: "void", metadata: { contractState: "cancelled", reason: parsed.data.reason } }).where(eq(designOutputs.id, row.agreement.outputId));
  res.json({ agreement: cancelled ? agreementJson(cancelled) : null });
});

router.post("/office/contracts/:agreementId/replace", requireStudio, async (req, res): Promise<void> => {
  const agreementId = param(req.params.agreementId);
  const [row] = await db.select({ agreement: contractAgreements, project: designProjects, version: designProjectVersions }).from(contractAgreements)
    .innerJoin(designProjects, eq(designProjects.id, contractAgreements.projectId))
    .innerJoin(designProjectVersions, eq(designProjectVersions.id, contractAgreements.versionId))
    .where(and(eq(contractAgreements.id, agreementId), eq(designProjects.officeAccountId, req.officeAccount!.accountId))).limit(1);
  if (!row) { res.status(404).json({ error: "Contract agreement not found." }); return; }
  if (!["cancelled", "declined", "expired", "failed"].includes(row.agreement.state)) { res.status(409).json({ error: "Cancel or finish the current agreement before replacing it." }); return; }
  const [replacement] = await db.insert(designProjects).values({
    officeAccountId: req.officeAccount!.accountId,
    name: `${row.project.name} replacement`,
    type: "contract",
    content: row.version.content,
    notes: `Replacement for agreement ${row.agreement.id}.`,
    linkedOrganizationId: row.agreement.organizationId,
    linkedContactId: row.agreement.contactId,
    linkedBookingId: row.agreement.bookingId,
  }).returning();
  if (!replacement) { res.status(500).json({ error: "Could not create the replacement." }); return; }
  await db.insert(designProjectVersions).values({ projectId: replacement.id, versionNumber: "v1", content: replacement.content, notes: replacement.notes, status: "draft", createdByAccountId: req.officeAccount!.accountId });
  await db.update(contractAgreements).set({ state: "replaced", terminalAt: new Date(), updatedAt: new Date() }).where(eq(contractAgreements.id, agreementId));
  res.status(201).json({ project: replacement });
});

router.get("/office/contracts/:agreementId/file/:kind", requireStudio, async (req, res): Promise<void> => {
  const agreementId = param(req.params.agreementId);
  const kind = param(req.params.kind);
  const [row] = await db.select({ agreement: contractAgreements }).from(contractAgreements)
    .innerJoin(designProjects, eq(designProjects.id, contractAgreements.projectId))
    .where(and(eq(contractAgreements.id, agreementId), eq(designProjects.officeAccountId, req.officeAccount!.accountId))).limit(1);
  const key = kind === "signed" ? row?.agreement.signedPdfStorageKey : kind === "audit" ? row?.agreement.auditTrailStorageKey : null;
  if (!key) { res.status(404).json({ error: "That contract file is not available." }); return; }
  res.json({ url: await storage.getSignedReadUrl(key, 15 * 60) });
});

router.post("/adobe/sign/webhook", async (req, res): Promise<void> => {
  const raw = JSON.stringify(req.body ?? {});
  if (!adobe.verifyWebhook(raw, req.get("x-adobe-signature") ?? undefined)) { res.status(401).json({ error: "Invalid Adobe Sign webhook signature." }); return; }
  const payload = req.body as Record<string, any>;
  const providerAgreementId = String(payload.agreement?.id ?? payload.agreementId ?? "");
  const eventType = String(payload.event ?? payload.eventType ?? "unknown");
  const providerStatus = String(payload.agreement?.status ?? payload.status ?? "");
  const providerEventId = String(payload.webhookNotificationId ?? payload.eventId ?? createHash("sha256").update(raw).digest("hex"));
  const [agreement] = await db.select().from(contractAgreements).where(eq(contractAgreements.providerAgreementId, providerAgreementId)).limit(1);
  if (!agreement) { res.status(202).json({ accepted: true, matched: false }); return; }
  const [event] = await db.insert(contractProviderEvents).values({ agreementId: agreement.id, providerEventId, eventType, providerStatus, payload, occurredAt: payload.eventDate ? new Date(payload.eventDate) : null }).onConflictDoNothing().returning();
  if (!event) { res.json({ accepted: true, duplicate: true }); return; }
  await applyProviderState(agreement, adobeState(providerStatus, eventType), providerStatus);
  res.json({ accepted: true });
});

// Local signature simulation is intentionally disabled. Only Acrobat Sign events can advance signer state.
router.post("/office/design-studio/outputs/:outputId/sign", requireStudio, (_req, res) => {
  res.status(410).json({ error: "Signatures must be completed and confirmed through Acrobat Sign." });
});

export default router;