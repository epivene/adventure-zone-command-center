import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";

const router: IRouter = Router();

function followUpRepo() {
  return new DrizzleBookingRepository(db);
}

const updateFollowUpSchema = z
  .object({
    kind: z.string().trim().min(1, "Choose a follow-up type."),
    dueAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD date format.")
      .transform((s) => new Date(`${s}T00:00:00.000Z`)),
  })
  .strict();

router.patch("/follow-ups/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = updateFollowUpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const result = await followUpRepo().updateFollowUp(id, parsed.data);
    if (!result.ok) {
      const msg =
        result.error.code === "FOLLOW_UP_NOT_FOUND"
          ? "Follow-up not found."
          : result.error.code === "FOLLOW_UP_ALREADY_COMPLETED"
            ? "Completed follow-ups cannot be edited."
            : "Could not update follow-up.";
      res
        .status(result.error.code === "FOLLOW_UP_NOT_FOUND" ? 404 : 409)
        .json({ ok: false, error: msg });
      return;
    }
    res.json({ ok: true, followUp: result.value });
  } catch (err) {
    req.log.error({ err }, "Failed to update follow-up");
    res.status(500).json({ ok: false, error: "Could not update follow-up." });
  }
});

router.delete("/follow-ups/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const result = await followUpRepo().deleteFollowUp(id);
    if (!result.ok) {
      const msg =
        result.error.code === "FOLLOW_UP_NOT_FOUND"
          ? "Follow-up not found."
          : result.error.code === "FOLLOW_UP_ALREADY_COMPLETED"
            ? "Completed follow-ups cannot be deleted."
            : result.error.code === "FOLLOW_UP_HAS_CALL"
              ? "This follow-up has a recorded call and cannot be deleted."
              : "Could not delete follow-up.";
      const status = result.error.code === "FOLLOW_UP_NOT_FOUND" ? 404 : 409;
      res.status(status).json({ ok: false, error: msg });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete follow-up");
    res.status(500).json({ ok: false, error: "Could not delete follow-up." });
  }
});

export default router;
