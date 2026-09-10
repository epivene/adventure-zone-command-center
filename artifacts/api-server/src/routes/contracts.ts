import { OutreachError } from "../features/outreach-planner/outreach-repository";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import {
  ContractDraftServiceError,
} from "@/features/contracts/contract-draft-service";
import {
  ContractFileServiceError,
} from "@/features/contracts/contract-file-service";
import { isContractBuilderEnabled } from "@/features/contracts/contract-feature-enabled";
import { ContractLifecycleServiceError } from "@/features/contracts/contract-lifecycle-service";
import type { ContractValues } from "@/features/contracts/contract-types";

type DraftRoutes = {
  start(input: { bookingId: string; actorId: string }): Promise<{ draft: unknown; reused: boolean }>;
  save(input: { draftId: string; expectedRevision: number; values: ContractValues; actorId: string }): Promise<unknown>;
  finalize(input: { draftId: string; actorId: string }): Promise<{ version: unknown; reused: boolean }>;
  createReplacement(input: { contractVersionId: string; actorId: string }): Promise<unknown>;
};

export type ContractRouteServices = {
  drafts: DraftRoutes;
  queries: {
    listOrganization(organizationId: string): Promise<unknown>;
    listBooking(bookingId: string): Promise<unknown>;
    getVersion(versionId: string): Promise<unknown | null>;
    getDraft(draftId: string): Promise<unknown | null>;
  };
  files: {
    open(input: { contractVersionId: string; fileId: string }): Promise<string>;
    storeSigned(input: { contractVersionId: string; bytes: Uint8Array; mimeType: string; originalFilename: string; actorId: string }): Promise<unknown>;
  };
  lifecycle: {
    confirmAdobeSent(input: { contractVersionId: string; actorId: string }): Promise<unknown>;
    transition(input: { contractVersionId: string; toStatus: "partially_signed" | "declined" | "cancelled" | "superseded"; actorId: string; idempotencyKey: string }): Promise<unknown>;
    confirmSignedFile(input: { contractVersionId: string; fileId: string; actorId: string }): Promise<unknown>;
  };
  coi: {
    createOrRecover(input: { contractVersionId: string; actorId: string }): Promise<{ record: unknown; reused: boolean }>;
  };
  settings: {
    get(): Promise<unknown>;
    update(input: { internalSignerName: string; internalSignerEmail: string | null; insuranceRecipientName: string; insuranceRecipientEmail: string; actorId: string; now: Date }): Promise<unknown>;
  };
};

const saveSchema = z.object({
  expectedRevision: z.number().int().positive(),
  values: z.record(z.string(), z.unknown()),
}).strict();
const fileOpenSchema = z.object({ fileId: z.string().trim().min(1).max(200) }).strict();
const statusSchema = z.object({ status: z.enum(["partially_signed", "declined", "cancelled", "superseded"]) }).strict();
const confirmSignedSchema = z.object({ confirmed: z.literal(true) }).strict();
const settingsSchema = z.object({
  internalSignerName: z.string().trim().min(1).max(200),
  internalSignerEmail: z.union([z.string().email(), z.literal("")]).transform((value) => value || null),
  insuranceRecipientName: z.string().trim().min(1).max(200),
  insuranceRecipientEmail: z.string().email(),
}).strict();

function param(req: Request, name: string) {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function actor(req: Request) {
  return String((req as Request & { userId?: string }).userId || "owner");
}

function mapError(error: unknown, res: Response) {
  if (error instanceof OutreachError) { res.status(error.status).json({error:error.message}); return; }
  if (error instanceof ContractDraftServiceError) {
    if (error.code === "CONTRACT_DRAFT_STALE") {
      res.status(409).json({
        error: "This contract changed in another session. Refresh before saving.",
        currentRevision: error.details.currentRevision,
      });
      return;
    }
    const missing = ["CONTRACT_BOOKING_NOT_FOUND", "CONTRACT_DRAFT_NOT_FOUND", "CONTRACT_VERSION_NOT_FOUND"].includes(error.code);
    res.status(missing ? 404 : 400).json({ error: error.message });
    return;
  }
  if (error instanceof ContractFileServiceError) {
    res.status(error.code === "CONTRACT_FILE_NOT_FOUND" ? 404 : 400).json({ error: error.message });
    return;
  }
  if (error instanceof ContractLifecycleServiceError) {
    const status = error.code === "CONTRACT_VERSION_NOT_FOUND" ? 404 : error.code === "CONTRACT_TRANSITION_STALE" ? 409 : 400;
    res.status(status).json({ error: error.message });
    return;
  }
  res.status(503).json({ error: "Contract service is temporarily unavailable." });
}

export function createContractsRouter(input: { enabled?: boolean; services: ContractRouteServices }) {
  const router = Router();
  const enabled = input.enabled ?? isContractBuilderEnabled();
  const guard = (_req: Request, res: Response, next: NextFunction) => {
    if (!enabled) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    next();
  };

  router.get("/contracts/settings", async (_req, res) => {
    if (!enabled) {
      res.json({ enabled: false });
      return;
    }
    try {
      res.json({ enabled: true, ...await input.services.settings.get() as object });
    } catch (error) { mapError(error, res); }
  });

  router.patch("/contracts/settings", guard, async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter valid signer and insurance contact details." });
      return;
    }
    try {
      res.json({ settings: await input.services.settings.update({ ...parsed.data, actorId: actor(req), now: new Date() }) });
    } catch (error) { mapError(error, res); }
  });

  router.post("/bookings/:bookingId/contract-draft", guard, async (req, res) => {
    try {
      const result = await input.services.drafts.start({ bookingId: param(req, "bookingId"), actorId: actor(req) });
      res.status(result.reused ? 200 : 201).json(result);
    } catch (error) { mapError(error, res); }
  });

  router.patch("/contract-drafts/:draftId", guard, async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Provide a valid draft revision and contract values." });
      return;
    }
    try {
      const draft = await input.services.drafts.save({
        draftId: param(req, "draftId"),
        expectedRevision: parsed.data.expectedRevision,
        values: parsed.data.values as ContractValues,
        actorId: actor(req),
      });
      res.json({ draft });
    } catch (error) { mapError(error, res); }
  });

  router.get("/contract-drafts/:draftId", guard, async (req, res) => {
    try {
      const draft = await input.services.queries.getDraft(param(req, "draftId"));
      if (!draft) {
        res.status(404).json({ error: "Contract draft not found." });
        return;
      }
      res.json({ draft });
    } catch (error) { mapError(error, res); }
  });

  router.post("/contract-drafts/:draftId/finalize", guard, async (req, res) => {
    try {
      const result = await input.services.drafts.finalize({ draftId: param(req, "draftId"), actorId: actor(req) });
      res.status(result.reused ? 200 : 201).json(result);
    } catch (error) { mapError(error, res); }
  });

  router.post("/contracts/:contractVersionId/replacement", guard, async (req, res) => {
    try {
      const draft = await input.services.drafts.createReplacement({ contractVersionId: param(req, "contractVersionId"), actorId: actor(req) });
      res.status(201).json({ draft });
    } catch (error) { mapError(error, res); }
  });

  router.get("/organizations/:organizationId/contracts", guard, async (req, res) => {
    try {
      res.json(await input.services.queries.listOrganization(param(req, "organizationId")));
    } catch (error) { mapError(error, res); }
  });

  router.get("/bookings/:bookingId/contracts", guard, async (req, res) => {
    try {
      res.json(await input.services.queries.listBooking(param(req, "bookingId")));
    } catch (error) { mapError(error, res); }
  });

  router.get("/contracts/:contractVersionId", guard, async (req, res) => {
    try {
      const version = await input.services.queries.getVersion(param(req, "contractVersionId"));
      if (!version) {
        res.status(404).json({ error: "Contract version not found." });
        return;
      }
      res.json({ version });
    } catch (error) { mapError(error, res); }
  });

  router.post("/contracts/:contractVersionId/file/open", guard, async (req, res) => {
    const parsed = fileOpenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Select a contract file to open." });
      return;
    }
    try {
      const url = await input.services.files.open({ contractVersionId: param(req, "contractVersionId"), fileId: parsed.data.fileId });
      res.json({ url });
    } catch (error) { mapError(error, res); }
  });

  router.post("/contracts/:contractVersionId/confirm-adobe-sent", guard, async (req, res) => {
    try {
      res.json(await input.services.lifecycle.confirmAdobeSent({ contractVersionId: param(req, "contractVersionId"), actorId: actor(req) }));
    } catch (error) { mapError(error, res); }
  });

  router.post("/contracts/:contractVersionId/status", guard, async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Select a valid contract status." });
      return;
    }
    const contractVersionId = param(req, "contractVersionId");
    try {
      res.json(await input.services.lifecycle.transition({
        contractVersionId,
        toStatus: parsed.data.status,
        actorId: actor(req),
        idempotencyKey: `manual-status:${contractVersionId}:${parsed.data.status}`,
      }));
    } catch (error) { mapError(error, res); }
  });

  router.put(
    "/contracts/:contractVersionId/signed-file",
    guard,
    express.raw({ type: "application/pdf", limit: "20mb" }),
    async (req, res) => {
      if (req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/pdf") {
        res.status(415).json({ error: "Upload a PDF contract." });
        return;
      }
      const bytes = req.body instanceof Uint8Array ? req.body : new Uint8Array();
      const rawFilename = req.headers["x-file-name"];
      const originalFilename = (Array.isArray(rawFilename) ? rawFilename[0] : rawFilename)?.trim().slice(0, 240) || "signed-contract.pdf";
      try {
        const file = await input.services.files.storeSigned({
          contractVersionId: param(req, "contractVersionId"), bytes, mimeType: "application/pdf",
          originalFilename, actorId: actor(req),
        });
        res.status(201).json({ file });
      } catch (error) { mapError(error, res); }
    },
  );

  router.post("/contracts/:contractVersionId/signed-file/:fileId/confirm", guard, async (req, res) => {
    const parsed = confirmSignedSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Confirm that this is the completed signed agreement." });
      return;
    }
    const contractVersionId = param(req, "contractVersionId");
    try {
      const completion = await input.services.lifecycle.confirmSignedFile({
        contractVersionId, fileId: param(req, "fileId"), actorId: actor(req),
      });
      try {
        const coi = await input.services.coi.createOrRecover({ contractVersionId, actorId: actor(req) });
        res.json({ ...completion as object, coiDraft: coi.record });
      } catch {
        res.json({ ...completion as object, coiDraft: { state: "retryable_error" } });
      }
    } catch (error) { mapError(error, res); }
  });

  router.post("/contracts/:contractVersionId/coi-draft/retry", guard, async (req, res) => {
    try {
      const result = await input.services.coi.createOrRecover({ contractVersionId: param(req, "contractVersionId"), actorId: actor(req) });
      res.json({ coiDraft: result.record, reused: result.reused });
    } catch (error) { mapError(error, res); }
  });

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
      res.status(413).json({ error: "Contract PDFs cannot exceed 20 MB." });
      return;
    }
    next(error);
  });

  return router;
}
