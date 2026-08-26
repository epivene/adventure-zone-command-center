import type { Request, Response } from "express";
import { z } from "zod";
import { GmailDraftServiceError, type GmailDraftService } from "./gmail-draft-service";

const bodySchema = z.object({ expectedVersion: z.number().int().min(0) }).strict();
const uuid = z.string().uuid();
function parameter(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }

export function createLeadGmailDraftStateHandler(service: Pick<GmailDraftService, "get">) {
  return async (req: Request, res: Response): Promise<void> => {
    const rowId = parameter(req.params.rowId);
    if (!uuid.safeParse(rowId).success) {
      res.status(400).json({ error: { code: "INVALID_GMAIL_DRAFT_REQUEST", message: "A valid lead row is required." } });
      return;
    }
    try {
      res.json({ link: await service.get(rowId) });
    } catch (error) {
      (req as Request & { log?: { error?: (details: unknown, message: string) => void } }).log?.error?.({ error }, "Failed to load lead Gmail draft state");
      res.status(500).json({ error: { code: "LEAD_GMAIL_DRAFT_STATE_FAILED", message: "Could not load the Gmail draft state." } });
    }
  };
}

export function createLeadGmailDraftHandler(service: Pick<GmailDraftService, "create">) {
  return async (req: Request, res: Response): Promise<void> => {
    const rowId = parameter(req.params.rowId);
    const parsed = bodySchema.safeParse(req.body);
    if (!uuid.safeParse(rowId).success || !parsed.success) {
      res.status(400).json({ error: { code: "INVALID_GMAIL_DRAFT_REQUEST", message: "A single valid lead row and expected review version are required." } });
      return;
    }
    try {
      const result = await service.create({
        rowId,
        expectedVersion: parsed.data.expectedVersion,
        actorId: String((req as Request & { userId?: string }).userId ?? "owner").trim() || "owner",
      });
      res.status(result.reused ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof GmailDraftServiceError) {
        const status = error.code === "ROW_NOT_FOUND" ? 404 : error.code === "VERSION_CONFLICT" ? 409 : error.code === "NOT_READY" ? 422 : error.code === "GOOGLE_WORKSPACE_GMAIL_DRAFT_CREATE_FAILED" ? 502 : 409;
        res.status(status).json({ error: { code: error.code, message: error.message }, ...(error.blockers.length ? { blockers: error.blockers } : {}), ...error.details });
        return;
      }
      (req as Request & { log?: { error?: (details: unknown, message: string) => void } }).log?.error?.({ error }, "Failed to create lead Gmail draft");
      res.status(500).json({ error: { code: "LEAD_GMAIL_DRAFT_FAILED", message: "Could not create the Gmail draft." } });
    }
  };
}
