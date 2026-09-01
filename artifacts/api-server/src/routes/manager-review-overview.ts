import { Router, type IRouter } from "express";
import { db, pool } from "@workspace/db";
import { buildManagerReviewOverview } from "@/features/leg-manager/manager-review-overview";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";

const router: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(
  new DrizzleLegManagerRepository(db),
);

type BookingRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  status: string | null;
};

type ReviewRow = {
  id: string;
  booking_id: string;
  rating: number;
  feedback: string | null;
  organizer_site_notes: string | null;
  crew_notes: string | null;
  recommend_return: string | null;
  created_at: Date | string;
};

type DismissalRow = { booking_id: string };

router.get("/manager/reviews/due", requireManager, async (req, res): Promise<void> => {
  const legId = req.legManager!.legId;

  try {
    const [bookingResult, reviewResult, dismissalResult] = await Promise.all([
      pool.query<BookingRow>(
        `SELECT id,
                name,
                city,
                region,
                starts_at,
                ends_at,
                status::text AS status
           FROM bookings
          WHERE travel_leg_id = $1`,
        [legId],
      ),
      pool.query<ReviewRow>(
        `SELECT id,
                booking_id,
                rating,
                feedback,
                organizer_site_notes,
                crew_notes,
                recommend_return,
                created_at
           FROM event_manager_reviews
          WHERE leg_id = $1
          ORDER BY created_at DESC, id DESC`,
        [legId],
      ),
      pool.query<DismissalRow>(
        `SELECT booking_id
           FROM event_manager_review_dismissals
          WHERE leg_id = $1`,
        [legId],
      ),
    ]);

    const overview = buildManagerReviewOverview({
      bookings: bookingResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        city: row.city,
        region: row.region,
        startsAt: row.starts_at == null ? null : new Date(row.starts_at),
        endsAt: row.ends_at == null ? null : new Date(row.ends_at),
        status: row.status,
      })),
      reviews: reviewResult.rows.map((row) => ({
        id: row.id,
        bookingId: row.booking_id,
        rating: row.rating,
        feedback: row.feedback,
        organizerSiteNotes: row.organizer_site_notes,
        crewNotes: row.crew_notes,
        recommendReturn: row.recommend_return,
        createdAt: new Date(row.created_at),
      })),
      dismissedBookingIds: new Set(dismissalResult.rows.map((row) => row.booking_id)),
      now: new Date(),
    });

    res.json(overview);
  } catch (error) {
    req.log.error({ err: error, legId }, "Failed to load manager review overview");
    res.status(500).json({ error: "Could not load event reviews" });
  }
});

export default router;
