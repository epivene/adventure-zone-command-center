import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { createRequireOfficeMiddleware } from "@/features/office/office-middleware";
import { OfficeProfileEditor } from "@/features/office/office-profile-editor";
import {
  officeContactInputSchema,
  officeLocationInputSchema,
  officeNoteInputSchema,
  officeProfileInputSchema,
} from "@/features/office/office-profile-input";
import { OfficeProfileService } from "@/features/office/office-profile-service";

const router: IRouter = Router();
const requireOffice = createRequireOfficeMiddleware(new DrizzleOfficeAccountRepository(db));
const profiles = new OfficeProfileService(db);
const editor = new OfficeProfileEditor(db);
const uuid = z.string().uuid();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function officeActor(req: any) {
  return {
    accountId: req.officeAccount.accountId as string,
    displayName: req.officeAccount.displayName as string,
  };
}

function profileEditError(req: any, res: any, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("suppressed phone") ||
    message.includes("Contact phone") ||
    message.includes("primary phone") ||
    message.includes("normalized phone destination")
  ) {
    res.status(400).json({ error: message });
    return;
  }
  req.log.error({ err: error }, fallback);
  res.status(500).json({ error: "Could not save the profile changes." });
}

router.get("/office/profiles", requireOffice, async (req, res): Promise<void> => {
  const parsed = z.object({
    q: z.string().catch("").default(""),
    page: z.coerce.number().int().min(1).max(10000).catch(1).default(1),
  }).parse({ q: req.query.q ?? undefined, page: req.query.page ?? undefined });
  try {
    res.json(await profiles.listProfiles({ search: parsed.q.trim(), page: parsed.page }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to list Office Coordinator profiles");
    res.status(500).json({ error: "Could not load profiles." });
  }
});

router.get("/office/profiles/:profileId", requireOffice, async (req, res): Promise<void> => {
  const profileId = param(req.params.profileId);
  if (!uuid.safeParse(profileId).success) {
    res.status(400).json({ error: "Invalid profile ID." });
    return;
  }
  try {
    const profile = await profiles.getProfile(profileId);
    if (!profile) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json({ profile });
  } catch (error) {
    req.log.error({ err: error }, "Failed to load Office Coordinator profile");
    res.status(500).json({ error: "Could not load profile." });
  }
});

router.patch("/office/profiles/:profileId", requireOffice, async (req, res): Promise<void> => {
  const profileId = param(req.params.profileId);
  const parsed = officeProfileInputSchema.safeParse(req.body);
  if (!uuid.safeParse(profileId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid profile ID." : parsed.error.issues[0]?.message ?? "Review the profile changes." });
    return;
  }
  try {
    if (!(await editor.updateProfile(profileId, parsed.data, officeActor(req)))) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    profileEditError(req, res, error, "Failed Office Coordinator profile edit");
  }
});

router.put("/office/profiles/:profileId/contacts/:contactId", requireOffice, async (req, res): Promise<void> => {
  const profileId = param(req.params.profileId);
  const contactId = param(req.params.contactId);
  const parsed = officeContactInputSchema.safeParse(req.body);
  if (!uuid.safeParse(profileId).success || !uuid.safeParse(contactId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid profile or contact ID." : parsed.error.issues[0]?.message ?? "Review the contact changes." });
    return;
  }
  try {
    if (!(await editor.updateContact(profileId, contactId, parsed.data, officeActor(req)))) {
      res.status(404).json({ error: "That contact is not part of this profile." });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    profileEditError(req, res, error, "Failed Office Coordinator contact edit");
  }
});

router.patch("/office/profiles/:profileId/locations/:locationId", requireOffice, async (req, res): Promise<void> => {
  const profileId = param(req.params.profileId);
  const locationId = param(req.params.locationId);
  const parsed = officeLocationInputSchema.safeParse(req.body);
  if (!uuid.safeParse(profileId).success || !uuid.safeParse(locationId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid profile or location ID." : parsed.error.issues[0]?.message ?? "Review the location changes." });
    return;
  }
  try {
    if (!(await editor.updateLocation(profileId, locationId, parsed.data, officeActor(req)))) {
      res.status(404).json({ error: "That location is not part of this profile." });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    profileEditError(req, res, error, "Failed Office Coordinator location edit");
  }
});

router.post("/office/profiles/:profileId/notes", requireOffice, async (req, res): Promise<void> => {
  const profileId = param(req.params.profileId);
  const parsed = officeNoteInputSchema.safeParse(req.body);
  if (!uuid.safeParse(profileId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid profile ID." : parsed.error.issues[0]?.message ?? "Review the note." });
    return;
  }
  try {
    const result = await editor.addNote(profileId, parsed.data.body, officeActor(req));
    if (!result.ok) {
      res.status(400).json({ error: result.error.code === "INVALID_ACTIVITY_INPUT" ? result.error.message : "Could not add note." });
      return;
    }
    res.status(201).json({ note: result.value });
  } catch (error) {
    req.log.error({ err: error }, "Failed Office Coordinator note create");
    res.status(500).json({ error: "Could not add note." });
  }
});


export default router;
