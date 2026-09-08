import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  hashLegManagerPassword,
  verifyLegManagerPassword,
} from "@/features/leg-manager/leg-manager-auth";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { DrizzleScheduleIssueRepository } from "@/features/leg-manager/schedule-issue-repository";
import { DrizzleFinanceRepository } from "@/features/leg-manager/finance-repository";
import { DrizzleCrewRepository, listWorkersForManager } from "@/features/leg-manager/crew-repository";
import { crewRehireStatuses } from "@/features/leg-manager/crew-types";
import { DrizzleIncidentRepository } from "@/features/leg-manager/incident-repository";
import { GoogleCloudLegManagerObjectStorage } from "@/features/leg-manager/leg-manager-object-storage";
import { attachIncidentPhotoUrls } from "@/features/leg-manager/incident-photo-service";

const router: IRouter = Router();
const repo = new DrizzleLegManagerRepository(db);
const crew = new DrizzleCrewRepository(db);
const incidents = new DrizzleIncidentRepository(db);
const incidentStorage = new GoogleCloudLegManagerObjectStorage();
const access = z.object({ password: z.string().min(1) });
const duplicatePasswordMessage =
  "That password is already assigned to another manager. Choose a different password.";
const incidentIdSchema = z.string().uuid();
const incidentUpdateSchema = z.object({
  type: z.string().trim().min(1).max(160).optional(),
  occurredAt: z.coerce.date().optional(),
  locationText: z.string().trim().max(500).nullable().optional(),
  peopleInvolved: z.string().trim().max(2000).nullable().optional(),
  description: z.string().trim().min(1).max(8000).optional(),
  actionTaken: z.string().trim().max(8000).nullable().optional(),
  followUpNeeded: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one incident field is required" });

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

router.get("/manager-admin/legs/access", async (_req, res) => {
  res.json({ legs: await repo.listAdminStatuses() });
});

router.put("/manager-admin/legs/:legId/access", async (req, res): Promise<void> => {
  const parsed = access.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid manager access" });
    return;
  }
  const existing = await repo.listConfiguredPasswordRecords();
  for (const record of existing) {
    if (record.legId === req.params.legId) continue;
    if (await verifyLegManagerPassword(parsed.data.password, record.passwordHash, record.passwordSalt)) {
      res.status(409).json({ error: duplicatePasswordMessage });
      return;
    }
  }

  const { hash, salt } = await hashLegManagerPassword(parsed.data.password);
  const saved = await repo.setPassword({
    legId: req.params.legId,
    passwordHash: hash,
    passwordSalt: salt,
  });
  if (!saved) {
    res.status(409).json({ error: "Manager access can only be enabled for an active travel leg" });
    return;
  }

  res.json({
    ok: true,
    access: {
      legId: saved.legId,
      legName: saved.legName,
      enabled: true,
      sessionVersion: saved.sessionVersion,
    },
  });
});

router.post("/manager-admin/legs/:legId/sign-out-all", async (req, res): Promise<void> => {
  if (!(await repo.incrementSessionVersion(req.params.legId))) {
    res.status(404).json({ error: "Manager access has not been configured for this leg" });
    return;
  }
  res.json({ ok: true });
});

router.get("/manager-admin/issues", async (req, res) => {
  res.json({
    issues: await new DrizzleScheduleIssueRepository(db).list(
      typeof req.query.status === "string" ? req.query.status : "open",
    ),
  });
});

router.post("/manager-admin/issues/:id/resolve", async (req, res): Promise<void> => {
  const parsed = z.object({ resolutionNote: z.string().trim().min(1).max(4000) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Resolution note is required" });
    return;
  }
  const issue = await new DrizzleScheduleIssueRepository(db).resolve(req.params.id, parsed.data.resolutionNote);
  if (!issue) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  res.json({ issue });
});

router.get("/manager-admin/legs/:legId/money/summary", async (req, res) => {
  res.json(await new DrizzleFinanceRepository(db).summary(
    req.params.legId,
    typeof req.query.tripId === "string" ? req.query.tripId : null,
  ));
});

router.get("/manager-admin/money/summary", async (req, res) => {
  res.json(await new DrizzleFinanceRepository(db).summary(
    null,
    typeof req.query.tripId === "string" ? req.query.tripId : null,
  ));
});

router.get("/manager-admin/crew", async (_req, res) => {
  res.json({ workers: await listWorkersForManager(crew, "owner") });
});

router.post("/manager-admin/crew", async (req, res): Promise<void> => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(160),
    phone: z.string().trim().max(60).nullable().optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    region: z.string().trim().max(80).nullable().optional(),
    locationText: z.string().trim().max(240).nullable().optional(),
    rehireStatus: z.enum(crewRehireStatuses).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid worker" }); return; }
  res.status(201).json({ worker: await crew.createWorker(parsed.data) });
});

router.patch("/manager-admin/crew/:workerId/rehire-status", async (req, res): Promise<void> => {
  const workerId = param(req.params.workerId);
  const parsed = z.object({ rehireStatus: z.enum(crewRehireStatuses) }).safeParse(req.body);
  if (!workerId || !parsed.success) { res.status(400).json({ error: "Invalid rehire status" }); return; }
  const worker = await crew.updateRehireStatus(workerId, parsed.data.rehireStatus);
  if (!worker) { res.status(404).json({ error: "Worker not found" }); return; }
  res.json({ worker });
});

router.patch("/manager-admin/crew/work-history/:historyId", async (req, res): Promise<void> => {
  const historyId = param(req.params.historyId);
  const parsed = z.object({
    role: z.string().trim().min(1).max(160).optional(),
    startedAt: z.coerce.date().optional(),
    endedAt: z.coerce.date().nullable().optional(),
    rating: z.number().int().min(0).max(5).nullable().optional(),
    note: z.string().trim().max(4000).nullable().optional(),
  }).safeParse(req.body);
  if (!historyId || !parsed.success) { res.status(400).json({ error: "Invalid history update" }); return; }
  const entry = await crew.updateWorkHistory(historyId, parsed.data);
  if (!entry) { res.status(404).json({ error: "History entry not found" }); return; }
  res.json({ entry });
});

router.get("/manager-admin/incidents", async (req, res) => {
  const rows = await incidents.listAll();
  try {
    const attachments = await incidents.listAttachmentsForIncidents(rows.map((row) => row.id));
    res.json({ incidents: await attachIncidentPhotoUrls(rows, attachments, incidentStorage) });
  } catch (error) {
    req.log.warn({ err: error }, "Incident attachment enrichment failed");
    const fallbackIncidents = rows.map((row) => ({ ...row, attachments: [] }));
    res.json({ incidents: fallbackIncidents, warning: "incident_attachments_unavailable" });
  }
});

router.patch("/manager-admin/incidents/:incidentId", async (req, res): Promise<void> => {
  const incidentId = param(req.params.incidentId);
  const parsedId = incidentIdSchema.safeParse(incidentId);
  const parsed = incidentUpdateSchema.safeParse(req.body ?? {});
  if (!parsedId.success || !parsed.success) {
    res.status(400).json({ error: "Invalid incident update" });
    return;
  }
  const incident = await incidents.updateIncident(parsedId.data, parsed.data);
  if (!incident) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  const attachments = await incidents.listAttachmentsForIncidents([incident.id]);
  const [withPhotos] = await attachIncidentPhotoUrls([incident], attachments, incidentStorage);
  res.json({ incident: withPhotos ?? incident });
});

router.delete("/manager-admin/incidents/:incidentId", async (req, res): Promise<void> => {
  const incidentId = param(req.params.incidentId);
  const parsedId = incidentIdSchema.safeParse(incidentId);
  if (!parsedId.success) {
    res.status(400).json({ error: "Invalid incident id" });
    return;
  }

  const attachments = await incidents.listAttachmentsForIncidents([parsedId.data]);
  const deleted = await incidents.deleteIncident(parsedId.data);
  if (!deleted) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }

  const objectKeys = attachments
    .map((attachment) => attachment.objectKey)
    .filter((key): key is string => typeof key === "string" && key.trim().length > 0);
  const cleanup = await Promise.allSettled(objectKeys.map((key) => incidentStorage.delete(key)));
  const failures = cleanup.filter((result) => result.status === "rejected").length;
  if (failures > 0) {
    req.log.warn({ incidentId: parsedId.data, failures }, "Incident deleted but some attachment objects could not be removed");
  }
  res.json({ ok: true });
});

export default router;
