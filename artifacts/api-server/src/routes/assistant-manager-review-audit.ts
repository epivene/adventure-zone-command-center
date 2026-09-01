import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { isEventReviewDue } from "@/features/leg-manager/event-review-service";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const router: IRouter = Router();

router.use(requireAssistantImportToken);

type LegRow = {
  leg_id: string;
  manager_name: string | null;
  leg_name: string;
};

type BookingReviewRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  status: string | null;
  organization_name: string | null;
  review_id: string | null;
  rating: number | null;
  feedback: string | null;
  organizer_site_notes: string | null;
  crew_notes: string | null;
  recommend_return: string | null;
  review_created_at: Date | string | null;
};

function iso(value: Date | string | null) {
  return value == null ? null : new Date(value).toISOString();
}

router.get("/manager-review-audit", async (req, res): Promise<void> => {
  const managerQuery = typeof req.query.manager === "string" ? req.query.manager.trim() : "";
  if (managerQuery.length < 2) {
    res.status(400).json({ ok: false, error: "Enter at least 2 characters for the manager name." });
    return;
  }

  try {
    const like = `%${managerQuery}%`;
    const legResult = await pool.query<LegRow>(
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

    if (legResult.rows.length === 0) {
      res.status(404).json({ ok: false, error: "No configured leg manager matched that name." });
      return;
    }

    if (legResult.rows.length !== 1) {
      res.status(409).json({
        ok: false,
        error: "More than one configured leg manager matched that name.",
        matches: legResult.rows.map((row) => ({
          legId: row.leg_id,
          managerName: row.manager_name,
          legName: row.leg_name,
        })),
      });
      return;
    }

    const leg = legResult.rows[0]!;
    const bookingResult = await pool.query<BookingReviewRow>(
      `SELECT booking.id,
              booking.name,
              booking.city,
              booking.region,
              booking.starts_at,
              booking.ends_at,
              booking.status::text AS status,
              organization.name AS organization_name,
              review.id AS review_id,
              review.rating,
              review.feedback,
              review.organizer_site_notes,
              review.crew_notes,
              review.recommend_return,
              review.created_at AS review_created_at
         FROM bookings booking
         LEFT JOIN organizations organization ON organization.id = booking.organization_id
         LEFT JOIN LATERAL (
           SELECT item.id,
                  item.rating,
                  item.feedback,
                  item.organizer_site_notes,
                  item.crew_notes,
                  item.recommend_return,
                  item.created_at
             FROM event_manager_reviews item
            WHERE item.booking_id = booking.id
              AND item.leg_id = booking.travel_leg_id
            ORDER BY item.created_at DESC, item.id DESC
            LIMIT 1
         ) review ON true
        WHERE booking.travel_leg_id = $1
        ORDER BY booking.starts_at NULLS LAST, booking.created_at, booking.id`,
      [leg.leg_id],
    );

    const now = new Date();
    const bookings = bookingResult.rows.map((row) => {
      const startsAt = row.starts_at == null ? null : new Date(row.starts_at);
      const endsAt = row.ends_at == null ? null : new Date(row.ends_at);
      const hasReview = row.review_id != null;
      const due = !hasReview && isEventReviewDue({ startsAt, endsAt }, now);
      const upcoming = !hasReview && !due && (endsAt ?? startsAt) != null;
      return {
        id: row.id,
        name: row.name,
        city: row.city,
        region: row.region,
        startsAt: iso(row.starts_at),
        endsAt: iso(row.ends_at),
        status: row.status,
        organizationName: row.organization_name,
        state: hasReview ? "completed" : due ? "due" : upcoming ? "upcoming" : "undated",
        review: hasReview
          ? {
              id: row.review_id,
              rating: row.rating,
              feedback: row.feedback,
              organizerSiteNotes: row.organizer_site_notes,
              crewNotes: row.crew_notes,
              recommendReturn: row.recommend_return,
              createdAt: iso(row.review_created_at),
            }
          : null,
      };
    });

    res.json({
      ok: true,
      generatedAt: now.toISOString(),
      managerQuery,
      leg: {
        id: leg.leg_id,
        managerName: leg.manager_name,
        name: leg.leg_name,
      },
      totals: {
        bookings: bookings.length,
        due: bookings.filter((booking) => booking.state === "due").length,
        completed: bookings.filter((booking) => booking.state === "completed").length,
        upcoming: bookings.filter((booking) => booking.state === "upcoming").length,
        undated: bookings.filter((booking) => booking.state === "undated").length,
      },
      bookings,
    });
  } catch (error) {
    req.log.error({ err: error, managerQuery }, "Failed manager review audit");
    res.status(500).json({ ok: false, error: "Manager review audit failed." });
  }
});

export default router;
