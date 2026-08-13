import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import { createContactPhoneRepository } from "@/features/contact-phones/contact-phone-repository";
import { contactFormInputSchema, contactListQuerySchema, replaceContactPhonesSchema } from "@/features/contacts/contact-input";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";

const router: IRouter = Router();
function contactRepo() { return new DrizzleContactRepository(db); }

router.get("/contacts", async (req, res): Promise<void> => {
  const query = contactListQuerySchema.parse({
    q: req.query.q ?? undefined,
    state: req.query.state ?? undefined,
    page: req.query.page ?? undefined,
  });
  try {
    const contacts = await contactRepo().listContacts(query);
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
    const contact = await contactRepo().createContact(parsed.data);
    res.status(201).json({ ok: true, contactId: (contact as any).id ?? (contact as any).contact?.id });
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
    const timeline = await new ActivityService(
      new DrizzleActivityRepository(db),
    ).listTimeline({ contactId: id });
    res.json({ ...detail, timeline });
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

export default router;
