import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { createRequireOfficeMiddleware } from "@/features/office/office-middleware";
import { DrizzleOfficeEmailRepository } from "@/features/office/office-email-repository";
import { OfficeEmailError } from "@/features/office/office-email-service";
import officeCommunicationTemplatesRouter from "./office-communication-templates";
import { LeadEmailPreviewRepository } from "@/features/lead-intake/lead-email-preview-repository";
import { PostgresGmailDraftPersistence } from "@/features/lead-intake/gmail-draft-service";

const router: IRouter = Router();
const requireOffice = createRequireOfficeMiddleware(new DrizzleOfficeAccountRepository(db));
const drafts = new DrizzleOfficeEmailRepository(db);
const leadGmailDrafts = new PostgresGmailDraftPersistence(db, new LeadEmailPreviewRepository(db));
const uuid = z.string().uuid();
const nullableNote = z.union([z.string().max(4000), z.null()]).transform((value) => value?.trim() || null);

router.use(officeCommunicationTemplatesRouter);

const createSchema = z.object({
  organizationId: uuid,
  contactId: uuid,
  communicationTemplateId: uuid.nullable().optional(),
  bookingId: uuid.nullable().optional(),
  eventYear: z.number().int().min(2000).max(2200).nullable().optional(),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(50000),
  coordinatorNote: nullableNote.optional(),
}).strict();
const patchSchema = z.object({
  subject: z.string().trim().min(1).max(500).optional(),
  body: z.string().trim().min(1).max(50000).optional(),
  coordinatorNote: nullableNote.optional(),
}).strict().refine((value) => Object.values(value).some((item) => item !== undefined), { message: "No draft changes provided." });

function param(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function emailError(res: any, error: unknown) {
  if (!(error instanceof OfficeEmailError)) return false;
  const messages = {
    NOT_FOUND: "Email draft not found.",
    INVALID_STATE: "This email can no longer be edited in its current state.",
    CONTACT_NOT_LINKED: "That recipient is not part of this profile.",
    EMAIL_REQUIRED: "That contact does not have an email address.",
    SEND_LOCKED: "This email is already being processed.",
    INVALID_TEMPLATE: "That email template is not available in the Booking Workspace.",
    INVALID_BOOKING: "That booking is not part of this profile.",
    UNRESOLVED_TEMPLATE_FIELD: "Finish the missing template details before submitting this email.",
  } as const;
  res.status(error.code === "NOT_FOUND" ? 404 : error.code === "SEND_LOCKED" ? 409 : 400).json({ error: messages[error.code] });
  return true;
}

router.get("/office/email-drafts", requireOffice, async (req, res) => {
  res.json({ drafts: await drafts.listForOffice(req.officeAccount!.accountId) });
});

router.get("/office/lead-gmail-drafts", requireOffice, async (_req, res) => {
  res.json({ drafts: await leadGmailDrafts.listForOffice() });
});

router.post("/office/email-drafts", requireOffice, async (req, res): Promise<void> => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the email draft." }); return; }
  try {
    const draft = await drafts.createForOffice({
      accountId: req.officeAccount!.accountId,
      ...parsed.data,
      communicationTemplateId: parsed.data.communicationTemplateId ?? null,
      bookingId: parsed.data.bookingId ?? null,
      eventYear: parsed.data.eventYear ?? null,
      coordinatorNote: parsed.data.coordinatorNote ?? null,
    });
    res.status(201).json({ draft });
  } catch (error) {
    if (emailError(res, error)) return;
    req.log.error({ err: error }, "Failed to create Office email draft");
    res.status(500).json({ error: "Could not save the email draft." });
  }
});

router.patch("/office/email-drafts/:draftId", requireOffice, async (req, res): Promise<void> => {
  const draftId = param(req.params.draftId);
  const parsed = patchSchema.safeParse(req.body);
  if (!uuid.safeParse(draftId).success || !parsed.success) { res.status(400).json({ error: parsed.success ? "Invalid draft ID." : parsed.error.issues[0]?.message ?? "Review the draft changes." }); return; }
  try {
    res.json({ draft: await drafts.updateForOffice(draftId, req.officeAccount!.accountId, parsed.data) });
  } catch (error) {
    if (emailError(res, error)) return;
    req.log.error({ err: error }, "Failed to update Office email draft");
    res.status(500).json({ error: "Could not update the email draft." });
  }
});

router.post("/office/email-drafts/:draftId/submit", requireOffice, async (req, res): Promise<void> => {
  const draftId = param(req.params.draftId);
  if (!uuid.safeParse(draftId).success) { res.status(400).json({ error: "Invalid draft ID." }); return; }
  try {
    const draft = await drafts.submitForOffice(draftId, req.officeAccount!.accountId, req.officeAccount!.displayName);
    res.json({ draft });
  } catch (error) {
    if (emailError(res, error)) return;
    req.log.error({ err: error }, "Failed to submit Office email draft");
    res.status(500).json({ error: "Could not submit the email draft." });
  }
});

export default router;


