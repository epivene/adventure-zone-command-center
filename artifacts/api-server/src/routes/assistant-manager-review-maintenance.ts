import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { isEventReviewDue } from "@/features/leg-manager/event-review-service";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const router: IRouter = Router();
router.use(requireAssistantImportToken);

const dismissalSchema = z.object({
  manager: z.string().trim().min(2).max(160),
  bookingIds: z.array(z.string().uuid()).min(1).max(50).refine(
    (ids) => new Set(ids).size === ids.length,
    { message: "Booking ids must be unique" },
  ),
  reason: z.string().trim().min(1).max(1000),
});

type LegRow = {
  leg_id: string;
  manager_name: string | null;
  leg_name: string;
};

type BookingRow = {
  id: string;
  name: string;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
};

async function findSingleManagerLeg(manager: string): Promise<LegRow[]> {
  const like = `%${manager}%`;
  const result = await pool.query<LegRow>(
    `SELECT access.leg_id,
            access.manager_name,
            leg.name AS leg_name
       FROM leg_manager_access access
       JOIN travel_legs leg ON leg.id = access.leg_id
      WHERE lower(coalesce(access.manager_name, '')) LIKE lower($1)
         OR lower(leg.name) LIKE lower($1)
      ORDER BY leg.name, access.leg_id`,
    [like],
  );
  return result.rows;
}

router.post("/manager-review-dismissals", async (req, res): Promise<void> => {
  const parsed = dismissalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid review dismissal request",
    });
    return;
  }

  const managerMatches = await findSingleManagerLeg(parsed.data.manager);
  if (managerMatches.length === 0) {
    res.status(404).json({ ok: false, error: "No configured leg manager matched that name." });
    return;
  }
  if (managerMatches.length !== 1) {
    res.status(409).json({
      ok: false,
      error: "More than one configured leg manager matched that name.",
      matches: managerMatches.map((row) => ({
        legId: row.leg_id,
        managerName: row.manager_name,
        legName: row.leg_name,
      })),
    });
    return;
  }

  const leg = managerMatches[0]!;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const bookingResult = await client.query<BookingRow>(
      `SELECT id, name, starts_at, ends_at
         FROM bookings
        WHERE travel_leg_id = $1
          AND id = ANY($2::uuid[])
        ORDER BY id
        FOR UPDATE`,
      [leg.leg_id, parsed.data.bookingIds],
    );

    const foundIds = new Set(bookingResult.rows.map((row) => row.id));
    const missingIds = parsed.data.bookingIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({
        ok: false,
        error: "One or more bookings are not assigned to the matched manager leg.",
        missingBookingIds: missingIds,
      });
      return;
    }

    const reviewedResult = await client.query<{ booking_id: string }>(
      `SELECT DISTINCT booking_id
         FROM event_manager_reviews
        WHERE leg_id = $1
          AND booking_id = ANY($2::uuid[])`,
      [leg.leg_id, parsed.data.bookingIds],
    );
    if (reviewedResult.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({
        ok: false,
        error: "A completed manager report cannot be dismissed.",
        reviewedBookingIds: reviewedResult.rows.map((row) => row.booking_id),
      });
      return;
    }

    const tableResult = await client.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.event_wrap_ups')::text AS table_name",
    );
    const wrapUpsTablePresent = tableResult.rows[0]?.table_name === "event_wrap_ups";
    if (wrapUpsTablePresent) {
      const submittedWrapUps = await client.query<{ booking_id: string }>(
        `SELECT DISTINCT booking_id
           FROM event_wrap_ups
          WHERE leg_id = $1
            AND booking_id = ANY($2::uuid[])
            AND status IN ('submitted', 'reviewed')`,
        [leg.leg_id, parsed.data.bookingIds],
      );
      if (submittedWrapUps.rows.length > 0) {
        await client.query("ROLLBACK");
        res.status(409).json({
          ok: false,
          error: "A submitted event wrap-up cannot be dismissed.",
          submittedBookingIds: submittedWrapUps.rows.map((row) => row.booking_id),
        });
        return;
      }
    }

    const now = new Date();
    const notDue = bookingResult.rows.filter((row) =>
      !isEventReviewDue(
        {
          startsAt: row.starts_at == null ? null : new Date(row.starts_at),
          endsAt: row.ends_at == null ? null : new Date(row.ends_at),
        },
        now,
      ),
    );
    if (notDue.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({
        ok: false,
        error: "Upcoming or undated events cannot be dismissed from the review queue.",
        notDue: notDue.map((row) => ({ id: row.id, name: row.name })),
      });
      return;
    }

    const inserted = await client.query<{
      booking_id: string;
      leg_id: string;
      dismissed_at: Date | string;
    }>(
      `INSERT INTO event_manager_review_dismissals
        (booking_id, leg_id, reason, dismissed_by, dismissed_at, updated_at)
       SELECT booking.id,
              $1,
              $3,
              'owner-requested-cleanup',
              now(),
              now()
         FROM bookings booking
        WHERE booking.travel_leg_id = $1
          AND booking.id = ANY($2::uuid[])
          AND NOT EXISTS (
            SELECT 1
              FROM event_manager_reviews review
             WHERE review.booking_id = booking.id
               AND review.leg_id = $1
          )
       ON CONFLICT (booking_id, leg_id)
       DO UPDATE SET
         reason = EXCLUDED.reason,
         dismissed_by = EXCLUDED.dismissed_by,
         dismissed_at = EXCLUDED.dismissed_at,
         updated_at = now()
       RETURNING booking_id, leg_id, dismissed_at`,
      [leg.leg_id, parsed.data.bookingIds, parsed.data.reason],
    );

    if (inserted.rows.length !== parsed.data.bookingIds.length) {
      await client.query("ROLLBACK");
      res.status(409).json({
        ok: false,
        error: "The review queue changed during cleanup; no dismissals were applied.",
      });
      return;
    }

    const finalReviews = await client.query<{ booking_id: string }>(
      `SELECT DISTINCT booking_id
         FROM event_manager_reviews
        WHERE leg_id = $1
          AND booking_id = ANY($2::uuid[])`,
      [leg.leg_id, parsed.data.bookingIds],
    );
    if (finalReviews.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({
        ok: false,
        error: "A completed report appeared during cleanup; no dismissals were applied.",
      });
      return;
    }

    if (wrapUpsTablePresent) {
      const finalWrapUps = await client.query<{ booking_id: string }>(
        `SELECT DISTINCT booking_id
           FROM event_wrap_ups
          WHERE leg_id = $1
            AND booking_id = ANY($2::uuid[])
            AND status IN ('submitted', 'reviewed')`,
        [leg.leg_id, parsed.data.bookingIds],
      );
      if (finalWrapUps.rows.length > 0) {
        await client.query("ROLLBACK");
        res.status(409).json({
          ok: false,
          error: "A submitted wrap-up appeared during cleanup; no dismissals were applied.",
        });
        return;
      }
    }

    await client.query("COMMIT");
    res.json({
      ok: true,
      leg: {
        id: leg.leg_id,
        managerName: leg.manager_name,
        name: leg.leg_name,
      },
      dismissed: inserted.rows.map((row) => ({
        bookingId: row.booking_id,
        dismissedAt: new Date(row.dismissed_at).toISOString(),
      })),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err: error, legId: leg.leg_id }, "Failed manager review cleanup");
    res.status(500).json({ ok: false, error: "Manager review cleanup failed." });
  } finally {
    client.release();
  }
});

export default router;
