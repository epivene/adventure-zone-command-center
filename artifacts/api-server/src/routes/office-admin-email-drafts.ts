import { createProductionOutreachDispatch } from "../features/outreach-planner/production-outreach-dispatch";
import { replayActualOutreach } from "../features/outreach-planner/outreach-events";
import { OutreachError } from "../features/outreach-planner/outreach-repository";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { officeEmailStateValues } from "@/db/schema";
import { DrizzleOfficeEmailRepository } from "@/features/office/office-email-repository";
import { OfficeEmailError } from "@/features/office/office-email-service";
import {
  createMailDeliveryFromEnv,
  MailConfigurationError,
} from "@/features/office/mail-delivery";
import { EarlyBirdPromoRepository } from "@/features/early-bird-promo/early-bird-promo-repository";
import { EarlyBirdPromoService } from "@/features/early-bird-promo/early-bird-promo-service";
import { OfficeEmailSendCoordinator } from "@/features/office/office-email-send-coordinator";

const router: IRouter = Router();
const drafts = new DrizzleOfficeEmailRepository(db);
const promotion = new EarlyBirdPromoService(new EarlyBirdPromoRepository(db));
const uuid = z.string().uuid();
const returnSchema = z
  .object({ note: z.string().trim().min(1).max(4000) })
  .strict();
const sendSchema = z
  .object({
    recipientEmail: z.string().trim().email().max(320).optional(),
    subject: z.string().trim().min(1).max(500).optional(),
    body: z.string().min(1).max(50000).optional(),
  })
  .strict();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
function emailStateError(res: any, error: unknown) {
  if (!(error instanceof OfficeEmailError)) return false;
  if (error.code === "NOT_FOUND")
    res.status(404).json({ error: "Email draft not found." });
  else if (error.code === "SEND_LOCKED")
    res
      .status(409)
      .json({
        error:
          "This email is already being processed or is no longer waiting to send.",
      });
  else
    res
      .status(409)
      .json({ error: "That email is not in a state that allows this action." });
  return true;
}

// Mounted after requireOwnerMiddleware in routes/index.ts. Saving never submits or sends.
const ownerDraftText = z
  .object({
    subject: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1).max(50000),
  })
  .strict();
const ownerDraftCreate = ownerDraftText.extend({
  organizationId: uuid,
  contactId: uuid,
});

router.get(
  "/office-admin/profile-email-drafts/:organizationId",
  async (req, res): Promise<void> => {
    const id = param(req.params.organizationId);
    if (!uuid.safeParse(id).success) {
      res.status(400).json({ error: "Invalid profile ID." });
      return;
    }
    res.json({ drafts: await drafts.listForProfile(id) });
  },
);

router.post("/office-admin/email-drafts", async (req, res): Promise<void> => {
  const parsed = ownerDraftCreate.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({
        error: parsed.error.issues[0]?.message ?? "Review the email draft.",
      });
    return;
  }
  try {
    res.status(201).json({ draft: await drafts.createForOwner(parsed.data) });
  } catch (error) {
    if (
      error instanceof OfficeEmailError &&
      ["CONTACT_NOT_LINKED", "EMAIL_REQUIRED"].includes(error.code)
    ) {
      res
        .status(400)
        .json({
          error:
            "Choose an active contact on this profile with an email address.",
        });
      return;
    }
    if (emailStateError(res, error)) return;
    req.log?.error?.({ err: error }, "Failed to save Booking email draft");
    res.status(500).json({ error: "Could not save the email draft." });
  }
});

router.patch(
  "/office-admin/email-drafts/:draftId",
  async (req, res): Promise<void> => {
    const id = param(req.params.draftId);
    const parsed = ownerDraftText.safeParse(req.body);
    if (!uuid.safeParse(id).success || !parsed.success) {
      res
        .status(400)
        .json({ error: "Add a subject and email body to a valid draft." });
      return;
    }
    try {
      res.json({ draft: await drafts.updateForOwner(id, parsed.data) });
    } catch (error) {
      if (emailStateError(res, error)) return;
      req.log?.error?.({ err: error }, "Failed to update Booking email draft");
      res.status(500).json({ error: "Could not update the email draft." });
    }
  },
);

router.get("/office-admin/email-drafts", async (req, res): Promise<void> => {
  const raw = typeof req.query.state === "string" ? req.query.state : null;
  const state =
    raw && officeEmailStateValues.includes(raw as any) ? (raw as any) : null;
  if (raw && !state) {
    res.status(400).json({ error: "Invalid draft state." });
    return;
  }
  res.json({ drafts: await drafts.listForOwner(state) });
});

router.post(
  "/office-admin/email-drafts/:draftId/return",
  async (req, res): Promise<void> => {
    const draftId = param(req.params.draftId);
    const parsed = returnSchema.safeParse(req.body);
    if (!uuid.safeParse(draftId).success || !parsed.success) {
      res
        .status(400)
        .json({
          error: parsed.success
            ? "Invalid draft ID."
            : (parsed.error.issues[0]?.message ?? "Add a return note."),
        });
      return;
    }
    try {
      res.json({
        draft: await drafts.returnForChanges(draftId, parsed.data.note),
      });
    } catch (error) {
      if (emailStateError(res, error)) return;
      req.log?.error?.({ err: error }, "Failed to return Office email draft");
      res
        .status(500)
        .json({ error: "Could not return the email for changes." });
    }
  },
);

router.post(
  "/office-admin/email-drafts/:draftId/send",
  async (req, res): Promise<void> => {
    const draftId = param(req.params.draftId);
    const parsed = sendSchema.safeParse(req.body);
    if (!uuid.safeParse(draftId).success || !parsed.success) {
      res
        .status(400)
        .json({
          error: parsed.success
            ? "Invalid draft ID."
            : (parsed.error.issues[0]?.message ?? "Review the email."),
        });
      return;
    }

    try {
      const coordinator = new OfficeEmailSendCoordinator({
        drafts,
        dispatchSafety: createProductionOutreachDispatch(db),
        outreachEvents: {
          replay: (opportunityId) => replayActualOutreach(db, opportunityId),
        },
        delivery: createMailDeliveryFromEnv(),
        promotion,
      });
      const draft = await coordinator.send({ draftId, overrides: parsed.data });
      res.json({ draft });
    } catch (error) {
      if (emailStateError(res, error)) return;
      if (error instanceof OutreachError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Email delivery failed.";
      if (error instanceof MailConfigurationError) {
        res.status(503).json({ error: message });
        return;
      }
      req.log?.error?.(
        { err: error, draftId },
        "Owner-reviewed Office email send failed",
      );
      res
        .status(502)
        .json({
          error:
            "Delivery or tracking needs review. Check the draft and provider outcome before retrying.",
        });
    }
  },
);

export default router;
