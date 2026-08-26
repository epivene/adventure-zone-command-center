import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleEventProfileRepository } from "@/features/event-profiles/event-profile-repository";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const router: IRouter = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.use(requireAssistantImportToken);

router.get("/profile-history/:profileId", async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.profileId) ? req.params.profileId[0] : req.params.profileId;
  if (!profileId || !UUID_PATTERN.test(profileId)) {
    res.status(400).json({ ok: false, error: "Enter a valid profile ID." });
    return;
  }

  try {
    const repository = new DrizzleEventProfileRepository(db);
    const profile = await repository.getEventProfile(profileId);
    if (!profile) {
      res.status(404).json({ ok: false, error: "Profile not found." });
      return;
    }

    res.json({
      ok: true,
      profileId: profile.id,
      place: profile.place,
      contacts: profile.contacts,
      bookings: profile.bookings,
      followUps: profile.followUps,
      notes: profile.notes,
      history: profile.history,
      migrationHistory: profile.migrationHistory ?? null,
    });
  } catch (error) {
    req.log.error({ err: error, profileId }, "Failed assistant profile history read");
    res.status(500).json({ ok: false, error: "Profile history read failed." });
  }
});

export default router;
