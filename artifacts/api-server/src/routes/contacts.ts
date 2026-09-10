import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import { ForgivingContactSearchService } from "@/features/contacts/forgiving-contact-search";
import { createContactPhoneRepository } from "@/features/contact-phones/contact-phone-repository";
import { atomicContactEditSchema, contactFormInputSchema, contactListQuerySchema, replaceContactPhonesSchema } from "@/features/contacts/contact-input";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";

const router: IRouter = Router();
function contactRepo() { return new DrizzleContactRepository(db); }

const phoneValidationErrors = new Set([
  "Contact phone numbers cannot be blank.",
  "Contact phone IDs must be unique.",
  "Exactly one contact phone must be primary.",
  "Contact phone does not belong to this contact.",
  "A suppressed phone number cannot be changed; add a new number to preserve suppression history.",
  "A suppressed phone number cannot be removed; keep it to preserve suppression history.",
  "That normalized phone destination already exists for this contact; edit the existing phone instead.",
]);

function isPhoneValidationError(err: unknown): err is Error {
  return err instanceof Error && phoneValidationErrors.has(err.message);
}

router.get("/contacts", async (req, res): Promise<void> => {
  const query = contactListQuerySchema.parse({
    q: req.query.q ?? undefined,
    state: req.query.state ?? undefined,
    page: req.query.page ?? undefined,
  });
  try {
    const contacts = await new ForgivingContactSearchService(contactRepo()).listContacts(query);
    res.json(contacts);
  } catch (err) {
    req.log.error({ err }, "Failed to list contacts");
    res.status(500).json({ error: "Failed to list contacts" });
  }
});

router.post("/contacts", async (req, res): Promise<void> => {
  const parsed = contactFormInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const contactId = await contactRepo().createContact(parsed.data);
    res.status(201).json({ ok: true, contactId });
  } catch (err) {
    req.log.error({ err }, "Failed to create contact");
    res.status(500).json({ ok: false, error: "Could not create contact" });
  }
});

router.get("/contacts/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const detail = await contactRepo().getContactDetail(id);
    if (!detail) { res.status(404).json({ error: "Not found" }); return; }
    const timelinePage = await new ActivityService(
      new DrizzleActivityRepository(db),
    ).listTimeline({ contactId: id });
    res.json({ ...detail, timeline: timelinePage.items, timelineNextPage: timelinePage.nextPage, assistedCallingEnabled: process.env.ASSISTED_CALLING_ENABLED === "true" });
  } catch (err) {
    req.log.error({ err }, "Failed to get contact");
    res.status(500).json({ error: "Failed to get contact" });
  }
});

router.put("/contacts/:id/phones", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = replaceContactPhonesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const phones = await createContactPhoneRepository(db).replaceForContact(id, parsed.data.phones, new Date());
    res.json({ phones });
  } catch (err) {
    if (err instanceof Error && err.message === "Contact is missing.") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (isPhoneValidationError(err)) {
      res.status(400).json({ ok: false, error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to replace contact phones");
    res.status(500).json({ ok: false, error: "Could not replace contact phones" });
  }
});

router.patch("/contacts/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = contactFormInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    await contactRepo().updateContact(id, parsed.data);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update contact");
    res.status(500).json({ ok: false, error: "Could not update contact" });
  }
});

router.put("/contacts/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = atomicContactEditSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const phones = await db.transaction(async (transaction) => {
      const savedPhones = await createContactPhoneRepository(transaction as unknown as typeof db)
        .replaceForContact(id, parsed.data.phones, new Date());
      const primaryPhone = savedPhones.find((phone) => phone.primary) ?? null;
      const updated = await new DrizzleContactRepository(transaction as unknown as typeof db)
        .updateContact(id, { ...parsed.data.contact, phone: primaryPhone?.number ?? null });
      if (!updated) throw new Error("Contact is missing.");
      return savedPhones;
    });
    res.json({ ok: true, phones });
  } catch (err) {
    if (err instanceof Error && err.message === "Contact is missing.") {
      res.status(404).json({ ok: false, error: "Not found" });
      return;
    }
    if (isPhoneValidationError(err)) {
      res.status(400).json({ ok: false, error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to update contact and phones");
    res.status(500).json({ ok: false, error: "Could not update contact" });
  }
});

export default router;
