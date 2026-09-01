import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { isEventReviewDue } from "@/features/leg-manager/event-review-service";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

export const managerReviewAuditRouter: IRouter = Router();

managerReviewAuditRouter.use(requireAssistantImportToken);

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
  dismissal_reason: string | null;
  dismissed_at: Date | string | null;
};

type WrapUpAuditRow = {
  id: string;
  booking_id: string;
  rating_stars: number | string | null;
  rating_notes: string | null;
  status: string;
  completed_at: Date | string;
};

function iso(value: Date | string | null) {
  return value == null ? null : new Date(value).toISOString();
}

managerReviewAuditRouter.get("/manager-review-audit", async (req, res): Promise<void> => {
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
              review.created_at AS review_created_at,
              dismissal.reason AS dismissal_reason,
              dismissal.dismissed_at
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
         LEFT JOIN event_manager_review_dismissals dismissal
           ON dismissal.booking_id = booking.id
          AND dismissal.leg_id = booking.travel_leg_id
        WHERE booking.travel_leg_id = $1
        ORDER BY booking.starts_at NULLS LAST, booking.created_at, booking.id`,
      [leg.leg_id],
    );

    const tableResult = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.event_wrap_ups')::text AS table_name",
    );
    const wrapUpResult = tableResult.rows[0]?.table_name === "event_wrap_ups"
      ? await pool.query<WrapUpAuditRow>(
          `SELECT id,
                  booking_id,
                  rating_stars,
                  rating_notes,
                  status,
                  coalesce(reviewed_at, submitted_at, updated_at) AS completed_at
             FROM event_wrap_ups
            WHERE leg_id = $1
              AND status IN ('submitted', 'reviewed')
            ORDER BY coalesce(reviewed_at, submitted_at, updated_at) DESC, id DESC`,
          [leg.leg_id],
        )
      : { rows: [] as WrapUpAuditRow[] };
    const wrapUpByBooking = new Map(
      wrapUpResult.rows.map((row) => [row.booking_id, row]),
    );

    const now = new Date();
    const bookings = bookingResult.rows.map((row) => {
      const startsAt = row.starts_at == null ? null : new Date(row.starts_at);
      const endsAt = row.ends_at == null ? null : new Date(row.ends_at);
      const managerReviewPresent = row.review_id != null;
      const fallbackWrapUp = managerReviewPresent ? null : wrapUpByBooking.get(row.id) ?? null;
      const hasReview = managerReviewPresent || fallbackWrapUp !== null;
      const dismissed = !hasReview && row.dismissed_at != null;
      const due = !hasReview && !dismissed && isEventReviewDue({ startsAt, endsAt }, now);
      const upcoming = !hasReview && !dismissed && !due && (endsAt ?? startsAt) != null;
      return {
        id: row.id,
        name: row.name,
        city: row.city,
        region: row.region,
        startsAt: iso(row.starts_at),
        endsAt: iso(row.ends_at),
        status: row.status,
        organizationName: row.organization_name,
        state: hasReview
          ? "completed"
          : dismissed
            ? "dismissed"
            : due
              ? "due"
              : upcoming
                ? "upcoming"
                : "undated",
        review: managerReviewPresent
          ? {
              id: row.review_id,
              source: "manager_review",
              rating: row.rating,
              feedback: row.feedback,
              organizerSiteNotes: row.organizer_site_notes,
              crewNotes: row.crew_notes,
              recommendReturn: row.recommend_return,
              createdAt: iso(row.review_created_at),
            }
          : fallbackWrapUp
            ? {
                id: fallbackWrapUp.id,
                source: "event_wrap_up",
                rating: fallbackWrapUp.rating_stars == null
                  ? null
                  : Number(fallbackWrapUp.rating_stars),
                feedback: fallbackWrapUp.rating_notes,
                organizerSiteNotes: null,
                crewNotes: null,
                recommendReturn: null,
                createdAt: iso(fallbackWrapUp.completed_at),
              }
            : null,
        dismissal: dismissed
          ? {
              reason: row.dismissal_reason,
              dismissedAt: iso(row.dismissed_at),
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
        dismissed: bookings.filter((booking) => booking.state === "dismissed").length,
        undated: bookings.filter((booking) => booking.state === "undated").length,
      },
      bookings,
    });
  } catch (error) {
    req.log.error({ err: error, managerQuery }, "Failed manager review audit");
    res.status(500).json({ ok: false, error: "Manager review audit failed." });
  }
});

export default managerReviewAuditRouter;
