import { pool as defaultPool } from "@workspace/db";
import { isEventReviewDue } from "./event-review-service";

export type ManagerLegMatch = {
  legId: string;
  managerName: string | null;
  legName: string;
};

export type ReviewCleanupCandidate = {
  id: string;
  name: string;
  city: string;
  region: string;
  startsAt: Date;
  endsAt: Date;
};

export type ReviewCleanupInspection = ReviewCleanupCandidate & {
  reviewCount: number;
  submittedWrapUpCount: number;
  dismissedAt: Date | null;
};

export interface KristyReviewCleanupRepository {
  findKristyLegs(): Promise<ManagerLegMatch[]>;
  inspectCandidates(legId: string, bookingIds: string[]): Promise<ReviewCleanupInspection[]>;
  dismissAll(
    legId: string,
    bookingIds: string[],
    reason: string,
  ): Promise<"applied" | "already_current" | "changed">;
}

export const KRISTY_STALE_REVIEW_CANDIDATES: readonly ReviewCleanupCandidate[] = [
  {
    id: "ff3dce3f-dad2-41a9-9ecf-c87bd448ed6f",
    name: "Moorcroft Jubilee Days",
    city: "Moorcroft",
    region: "WY",
    startsAt: new Date("2026-07-09T00:00:00.000Z"),
    endsAt: new Date("2026-07-12T00:00:00.000Z"),
  },
  {
    id: "e082626f-1759-48b7-b77c-4d6188e42ee9",
    name: "Sublette County Fair",
    city: "Big Piney",
    region: "WY",
    startsAt: new Date("2026-07-22T00:00:00.000Z"),
    endsAt: new Date("2026-07-25T00:00:00.000Z"),
  },
  {
    id: "21103588-3110-4a60-ac2c-d4f12655d5c5",
    name: "Uinta County Fair",
    city: "Evanston",
    region: "WY",
    startsAt: new Date("2026-07-29T00:00:00.000Z"),
    endsAt: new Date("2026-08-01T00:00:00.000Z"),
  },
  {
    id: "7320b7c9-91bf-4960-bda4-50b0d5b13815",
    name: "Laramie County Fair",
    city: "Cheyenne",
    region: "WY",
    startsAt: new Date("2026-08-01T00:00:00.000Z"),
    endsAt: new Date("2026-08-08T00:00:00.000Z"),
  },
  {
    id: "0ea10087-96ba-4268-8d32-b86a615a0896",
    name: "Chouteau County Fair",
    city: "Fort Benton",
    region: "MT",
    startsAt: new Date("2026-08-13T00:00:00.000Z"),
    endsAt: new Date("2026-08-15T00:00:00.000Z"),
  },
] as const;

const cleanupReason =
  "Owner requested removing these stale pre-Miles City wrap-up prompts while preserving the submitted Miles City report and upcoming Meeteetse event.";

function sameIdentity(actual: ReviewCleanupInspection, expected: ReviewCleanupCandidate) {
  return actual.id === expected.id
    && actual.name === expected.name
    && actual.city === expected.city
    && actual.region === expected.region
    && actual.startsAt.toISOString() === expected.startsAt.toISOString()
    && actual.endsAt.toISOString() === expected.endsAt.toISOString();
}

export async function cleanupKristyReviewQueue(
  repository: KristyReviewCleanupRepository = new PostgresKristyReviewCleanupRepository(),
  now = new Date(),
): Promise<
  | { status: "applied" | "already_current"; legId: string; bookingIds: string[] }
  | { status: "skipped"; reason: string; details?: unknown }
> {
  const legs = await repository.findKristyLegs();
  if (legs.length !== 1) {
    return {
      status: "skipped",
      reason: "manager_ambiguous",
      details: legs.map((leg) => ({
        legId: leg.legId,
        managerName: leg.managerName,
        legName: leg.legName,
      })),
    };
  }

  const legId = legs[0]!.legId;
  const bookingIds = KRISTY_STALE_REVIEW_CANDIDATES.map((candidate) => candidate.id);
  const inspected = await repository.inspectCandidates(legId, bookingIds);
  if (inspected.length !== KRISTY_STALE_REVIEW_CANDIDATES.length) {
    return {
      status: "skipped",
      reason: "candidate_changed",
      details: { expected: bookingIds, found: inspected.map((row) => row.id) },
    };
  }

  const inspectionById = new Map(inspected.map((row) => [row.id, row]));
  const changed = KRISTY_STALE_REVIEW_CANDIDATES.filter((expected) => {
    const actual = inspectionById.get(expected.id);
    return !actual || !sameIdentity(actual, expected);
  });
  if (changed.length > 0) {
    return {
      status: "skipped",
      reason: "candidate_changed",
      details: changed.map((candidate) => candidate.id),
    };
  }

  const completed = inspected.filter(
    (row) => row.reviewCount > 0 || row.submittedWrapUpCount > 0,
  );
  if (completed.length > 0) {
    return {
      status: "skipped",
      reason: "completed_report_present",
      details: completed.map((row) => row.id),
    };
  }

  const notDue = inspected.filter((row) => !isEventReviewDue(row, now));
  if (notDue.length > 0) {
    return {
      status: "skipped",
      reason: "candidate_not_due",
      details: notDue.map((row) => row.id),
    };
  }

  if (inspected.every((row) => row.dismissedAt !== null)) {
    return { status: "already_current", legId, bookingIds };
  }

  const result = await repository.dismissAll(legId, bookingIds, cleanupReason);
  if (result === "changed") {
    return { status: "skipped", reason: "queue_changed_during_cleanup" };
  }
  return { status: result, legId, bookingIds };
}

type QueryResult<T> = { rows: T[] };

type QueryExecutor = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
};

type QueryClient = QueryExecutor & {
  release(): void;
};

type QueryPool = QueryExecutor & {
  connect(): Promise<QueryClient>;
};

async function hasEventWrapUpsTable(database: QueryExecutor): Promise<boolean> {
  const result = await database.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.event_wrap_ups')::text AS table_name",
  );
  return result.rows[0]?.table_name === "event_wrap_ups";
}

async function submittedWrapUpCounts(
  database: QueryExecutor,
  legId: string,
  bookingIds: string[],
): Promise<Map<string, number>> {
  if (!(await hasEventWrapUpsTable(database))) return new Map();
  const result = await database.query<{
    booking_id: string;
    wrap_up_count: number | string;
  }>(
    `SELECT booking_id, count(*)::int AS wrap_up_count
       FROM event_wrap_ups
      WHERE leg_id = $1
        AND booking_id = ANY($2::uuid[])
        AND status IN ('submitted', 'reviewed')
      GROUP BY booking_id`,
    [legId, bookingIds],
  );
  return new Map(result.rows.map((row) => [row.booking_id, Number(row.wrap_up_count)]));
}

function lockedCandidateMatches(
  row: {
    id: string;
    name: string;
    city: string;
    region: string;
    starts_at: Date | string;
    ends_at: Date | string;
  },
  expected: ReviewCleanupCandidate,
) {
  return row.id === expected.id
    && row.name === expected.name
    && row.city === expected.city
    && row.region === expected.region
    && new Date(row.starts_at).toISOString() === expected.startsAt.toISOString()
    && new Date(row.ends_at).toISOString() === expected.endsAt.toISOString();
}

export class PostgresKristyReviewCleanupRepository implements KristyReviewCleanupRepository {
  constructor(private readonly database: QueryPool = defaultPool as unknown as QueryPool) {}

  async findKristyLegs(): Promise<ManagerLegMatch[]> {
    const result = await this.database.query<{
      leg_id: string;
      manager_name: string | null;
      leg_name: string;
    }>(
      `SELECT access.leg_id, access.manager_name, leg.name AS leg_name
         FROM leg_manager_access access
         JOIN travel_legs leg ON leg.id = access.leg_id
        WHERE lower(trim(coalesce(access.manager_name, ''))) = 'kristy'
        ORDER BY access.leg_id`,
    );
    return result.rows.map((row) => ({
      legId: row.leg_id,
      managerName: row.manager_name,
      legName: row.leg_name,
    }));
  }

  async inspectCandidates(
    legId: string,
    bookingIds: string[],
  ): Promise<ReviewCleanupInspection[]> {
    const result = await this.database.query<{
      id: string;
      name: string;
      city: string;
      region: string;
      starts_at: Date | string;
      ends_at: Date | string;
      review_count: number | string;
      dismissed_at: Date | string | null;
    }>(
      `SELECT booking.id,
              booking.name,
              booking.city,
              booking.region,
              booking.starts_at,
              booking.ends_at,
              count(review.id)::int AS review_count,
              max(dismissal.dismissed_at) AS dismissed_at
         FROM bookings booking
         LEFT JOIN event_manager_reviews review
           ON review.booking_id = booking.id
          AND review.leg_id = booking.travel_leg_id
         LEFT JOIN event_manager_review_dismissals dismissal
           ON dismissal.booking_id = booking.id
          AND dismissal.leg_id = booking.travel_leg_id
        WHERE booking.travel_leg_id = $1
          AND booking.id = ANY($2::uuid[])
        GROUP BY booking.id, booking.name, booking.city, booking.region,
                 booking.starts_at, booking.ends_at
        ORDER BY booking.id`,
      [legId, bookingIds],
    );

    const wrapUpCounts = await submittedWrapUpCounts(this.database, legId, bookingIds);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      region: row.region,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      reviewCount: Number(row.review_count),
      submittedWrapUpCount: wrapUpCounts.get(row.id) ?? 0,
      dismissedAt: row.dismissed_at == null ? null : new Date(row.dismissed_at),
    }));
  }

  async dismissAll(
    legId: string,
    bookingIds: string[],
    reason: string,
  ): Promise<"applied" | "already_current" | "changed"> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{
        id: string;
        name: string;
        city: string;
        region: string;
        starts_at: Date | string;
        ends_at: Date | string;
      }>(
        `SELECT booking.id,
                booking.name,
                booking.city,
                booking.region,
                booking.starts_at,
                booking.ends_at
           FROM bookings booking
          WHERE booking.travel_leg_id = $1
            AND booking.id = ANY($2::uuid[])
          ORDER BY booking.id
          FOR UPDATE`,
        [legId, bookingIds],
      );
      if (locked.rows.length !== bookingIds.length) {
        await client.query("ROLLBACK");
        return "changed";
      }

      const expectedById = new Map(
        KRISTY_STALE_REVIEW_CANDIDATES.map((candidate) => [candidate.id, candidate]),
      );
      if (locked.rows.some((row) => {
        const expected = expectedById.get(row.id);
        return !expected || !lockedCandidateMatches(row, expected);
      })) {
        await client.query("ROLLBACK");
        return "changed";
      }

      const reviewed = await client.query<{ booking_id: string }>(
        `SELECT DISTINCT review.booking_id
           FROM event_manager_reviews review
          WHERE review.leg_id = $1
            AND review.booking_id = ANY($2::uuid[])`,
        [legId, bookingIds],
      );
      if (reviewed.rows.length > 0) {
        await client.query("ROLLBACK");
        return "changed";
      }

      const wrapUpsTablePresent = await hasEventWrapUpsTable(client);
      if (wrapUpsTablePresent) {
        const submitted = await client.query<{ booking_id: string }>(
          `SELECT DISTINCT booking_id
             FROM event_wrap_ups
            WHERE leg_id = $1
              AND booking_id = ANY($2::uuid[])
              AND status IN ('submitted', 'reviewed')`,
          [legId, bookingIds],
        );
        if (submitted.rows.length > 0) {
          await client.query("ROLLBACK");
          return "changed";
        }
      }

      const existing = await client.query<{ booking_id: string }>(
        `SELECT booking_id
           FROM event_manager_review_dismissals
          WHERE leg_id = $1
            AND booking_id = ANY($2::uuid[])`,
        [legId, bookingIds],
      );
      if (existing.rows.length === bookingIds.length) {
        await client.query("COMMIT");
        return "already_current";
      }

      const inserted = await client.query<{ booking_id: string }>(
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
         RETURNING booking_id`,
        [legId, bookingIds, reason],
      );
      if (inserted.rows.length !== bookingIds.length) {
        await client.query("ROLLBACK");
        return "changed";
      }

      const finalReviews = await client.query<{ booking_id: string }>(
        `SELECT DISTINCT review.booking_id
           FROM event_manager_reviews review
          WHERE review.leg_id = $1
            AND review.booking_id = ANY($2::uuid[])`,
        [legId, bookingIds],
      );
      if (finalReviews.rows.length > 0) {
        await client.query("ROLLBACK");
        return "changed";
      }

      if (wrapUpsTablePresent) {
        const finalWrapUps = await client.query<{ booking_id: string }>(
          `SELECT DISTINCT booking_id
             FROM event_wrap_ups
            WHERE leg_id = $1
              AND booking_id = ANY($2::uuid[])
              AND status IN ('submitted', 'reviewed')`,
          [legId, bookingIds],
        );
        if (finalWrapUps.rows.length > 0) {
          await client.query("ROLLBACK");
          return "changed";
        }
      }

      await client.query("COMMIT");
      return "applied";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
