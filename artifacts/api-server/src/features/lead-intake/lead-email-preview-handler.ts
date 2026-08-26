import type { Request, Response } from "express";

import type { LeadEmailPreviewService } from "./lead-email-preview-service";
import { LeadEmailPreviewRepositoryError } from "./lead-email-preview-repository";

function parameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createLeadEmailPreviewHandler(service: Pick<LeadEmailPreviewService, "preview">) {
  return async (req: Request, res: Response): Promise<void> => {
    const rowId = parameter(req.params.rowId);
    const expectedVersion = Number(req.query.expectedVersion);
    if (!isUuid(rowId) || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
      res.status(400).json({ error: { code: "INVALID_PREVIEW_REQUEST", message: "A valid lead row and expected review version are required." } });
      return;
    }
    try {
      res.json({ preview: await service.preview(rowId, expectedVersion) });
    } catch (error) {
      if (error instanceof LeadEmailPreviewRepositoryError) {
        if (error.code === "VERSION_CONFLICT") {
          res.status(409).json({
            error: {
              code: error.code,
              message: error.message,
              expectedVersion: error.details.expectedVersion,
              currentVersion: error.details.currentVersion,
            },
          });
          return;
        }
        const status = error.code === "ROW_NOT_FOUND" ? 404 : 422;
        res.status(status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      req.log.error({ error }, "Failed to build safe lead email preview");
      res.status(500).json({ error: { code: "PREVIEW_FAILED", message: "Could not build lead email preview." } });
    }
  };
}
