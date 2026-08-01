import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import { contactFormInputSchema, contactListQuerySchema } from "@/features/contacts/contact-input";

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
    res.json(detail);
  } catch (err) {
    req.log.error({ err }, "Failed to get contact");
    res.status(500).json({ error: "Failed to get contact" });
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
