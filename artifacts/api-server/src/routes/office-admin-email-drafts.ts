import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { officeEmailStateValues } from "@/db/schema";
import { DrizzleOfficeEmailRepository } from "@/features/office/office-email-repository";
import { OfficeEmailError } from "@/features/office/office-email-service";
import { createMailDeliveryFromEnv, MailConfigurationError } from "@/features/office/mail-delivery";

const router: IRouter = Router();
const drafts = new DrizzleOfficeEmailRepository(db);
const uuid = z.string().uuid();
const returnSchema = z.object({ note: z.string().trim().min(1).max(4000) }).strict();
const sendSchema = z.object({
  recipientEmail: z.string().trim().email().max(320).optional(),
  subject: z.string().trim().min(1).max(500).optional(),
  body: z.string().min(1).max(50000).optional(),
}).strict();

function param(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function emailStateError(res: any, error: unknown) {
  if (!(error instanceof OfficeEmailError)) return false;
  if (error.code === "NOT_FOUND") res.status(404).json({ error: "Email draft not found." });
  else if (error.code === "SEND_LOCKED") res.status(409).json({ error: "This email is already being processed or is no longer waiting to send." });
  else res.status(409).json({ error: "That email is not in a state that allows this action." });
  return true;
}

router.get("/office-admin/email-drafts", async (req, res): Promise<void> => {
  const raw = typeof req.query.state === "string" ? req.query.state : null;
  const state = raw && officeEmailStateValues.includes(raw as any) ? raw as any : null;
  if (raw && !state) { res.status(400).json({ error: "Invalid draft state." }); return; }
  res.json({ drafts: await drafts.listForOwner(state) });
});

router.post("/office-admin/email-drafts/:draftId/return", async (req, res): Promise<void> => {
  const draftId = param(req.params.draftId);
  const parsed = returnSchema.safeParse(req.body);
  if (!uuid.safeParse(draftId).success || !parsed.success) { res.status(400).json({ error: parsed.success ? "Invalid draft ID." : parsed.error.issues[0]?.message ?? "Add a return note." }); return; }
  try {
    res.json({ draft: await drafts.returnForChanges(draftId, parsed.data.note) });
  } catch (error) {
    if (emailStateError(res, error)) return;
    req.log?.error?.({ err: error }, "Failed to return Office email draft");
    res.status(500).json({ error: "Could not return the email for changes." });
  }
});

router.post("/office-admin/email-drafts/:draftId/send", async (req, res): Promise<void> => {
  const draftId = param(req.params.draftId);
  const parsed = sendSchema.safeParse(req.body);
  if (!uuid.safeParse(draftId).success || !parsed.success) { res.status(400).json({ error: parsed.success ? "Invalid draft ID." : parsed.error.issues[0]?.message ?? "Review the email." }); return; }

  let claimed: any;
  try {
    claimed = await drafts.claimForSend(draftId);
  } catch (error) {
    if (emailStateError(res, error)) return;
    throw error;
  }

  const recipientEmail = parsed.data.recipientEmail ?? claimed.recipientEmail;
  const subject = parsed.data.subject ?? claimed.subject;
  const body = parsed.data.body ?? claimed.body;
  try {
    const delivery = createMailDeliveryFromEnv();
    const sent = await delivery.send({ to: recipientEmail, subject, body });
    const draft = await drafts.markSent(draftId, { recipientEmail, subject, body, messageId: sent.messageId });
    res.json({ draft });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email delivery failed.";
    try {
      await drafts.restoreSubmittedAfterFailure(draftId, message);
    } catch {
      // Preserve the original delivery failure response even if restoring state fails.
    }
    if (error instanceof MailConfigurationError) {
      res.status(503).json({ error: message });
      return;
    }
    req.log?.error?.({ err: error, draftId }, "Owner-reviewed Office email send failed");
    res.status(502).json({ error: "The email was not sent. It is still waiting for review so you can retry." });
  }
});

export default router;
