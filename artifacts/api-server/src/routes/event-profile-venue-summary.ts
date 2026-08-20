import { Router, type IRouter } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { bookings } from "@/db/schema";

const router: IRouter = Router();
const uuid = z.string().uuid();

const fields = {
  id: bookings.id,
  name: bookings.name,
  venueName: bookings.venueName,
  address1: bookings.address1,
  city: bookings.city,
  region: bookings.region,
  postalCode: bookings.postalCode,
  startsAt: bookings.startsAt,
};

router.get("/event-profiles/:id/venue-summary", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!uuid.safeParse(id).success) {
    res.status(400).json({ error: "Invalid profile ID." });
    return;
  }

  try {
    const now = new Date();
    const candidates = await db
      .select(fields)
      .from(bookings)
      .where(eq(bookings.organizationId, id))
      .orderBy(desc(bookings.startsAt), asc(bookings.id));

    const next = candidates
      .filter((booking) => booking.startsAt && booking.startsAt >= now)
      .sort((left, right) => Number(left.startsAt) - Number(right.startsAt))[0];
    const recent = candidates
      .filter((booking) => !booking.startsAt || booking.startsAt < now)[0];

    res.json({ venue: next ?? recent ?? null });
  } catch (err) {
    req.log.error({ err }, "Failed to load event venue summary");
    res.status(500).json({ error: "Could not load event venue." });
  }
});

export default router;
