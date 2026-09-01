import { pool as defaultPool } from "@workspace/db";

export type ManagerLegMatch = {
  legId: string;
  managerName: string | null;
  legName: string;
};

export type BookingIdentity = {
  id: string;
  name: string;
  city: string;
  region: string;
  startsAt: Date;
  endsAt: Date;
};

export type ReviewPromptIdentity = BookingIdentity & {
  status: "confirmed";
};

export type ReviewPromptInspection = ReviewPromptIdentity & {
  assignedLegId: string | null;
  dismissalPresent: boolean;
  reviewCount: number;
};

export type DonKingInspection = BookingIdentity & {
  status: string;
  assignedLegId: string | null;
  persistedAssignmentLegId: string | null;
};

export interface KristyReviewStateCorrectionRepository {
  findKristyLegs(): Promise<ManagerLegMatch[]>;
  inspectReviewPrompts(
    legId: string,
    bookingIds: string[],
  ): Promise<ReviewPromptInspection[]>;
  inspectDonKingDays(bookingId: string): Promise<DonKingInspection | null>;
  applyCorrection(input: {
    legId: string;
    restoreBookingIds: string[];
    donKingBookingId: string;
    unassignDonKing: boolean;
    clearDonKingPersistedAssignment: boolean;
    reason: string;
  }): Promise<"applied" | "already_current" | "changed">;
}

export const KRISTY_REVIEW_PROMPT_BOOKINGS: readonly ReviewPromptIdentity[] = [
  {
    id: "ff3dce3f-dad2-41a9-9ecf-c87bd448ed6f",
    name: "Moorcroft Jubilee Days",
    city: "Moorcroft",
    region: "WY",
    startsAt: new Date("2026-07-09T00:00:00.000Z"),
    endsAt: new Date("2026-07-12T00:00:00.000Z"),
    status: "confirmed",
  },
  {
    id: "e082626f-1759-48b7-b77c-4d6188e42ee9",
    name: "Sublette County Fair",
    city: "Big Piney",
    region: "WY",
    startsAt: new Date("2026-07-22T00:00:00.000Z"),
    endsAt: new Date("2026-07-25T00:00:00.000Z"),
    status: "confirmed",
  },
  {
    id: "21103588-3110-4a60-ac2c-d4f12655d5c5",
    name: "Uinta County Fair",
    city: "Evanston",
    region: "WY",
    startsAt: new Date("2026-07-29T00:00:00.000Z"),
    endsAt: new Date("2026-08-01T00:00:00.000Z"),
    status: "confirmed",
  },
  {
    id: "7320b7c9-91bf-4960-bda4-50b0d5b13815",
    name: "Laramie County Fair",
    city: "Cheyenne",
    region: "WY",
    startsAt: new Date("2026-08-01T00:00:00.000Z"),
    endsAt: new Date("2026-08-08T00:00:00.000Z"),
    status: "confirmed",
  },
  {
    id: "0ea10087-96ba-4268-8d32-b86a615a0896",
    name: "Chouteau County Fair",
    city: "Fort Benton",
    region: "MT",
    startsAt: new Date("2026-08-13T00:00:00.000Z"),
    endsAt: new Date("2026-08-15T00:00:00.000Z"),
    status: "confirmed",
  },
] as const;

export const DON_KING_DAYS_BOOKING: BookingIdentity = {
  id: "484ff870-2c5f-46f4-a55d-41b328c2337a",
  name: "Don King Days",
  city: "Sheridan",
  region: "WY",
  startsAt: new Date("2026-09-06T17:00:00.000Z"),
  endsAt: new Date("2026-09-07T17:00:00.000Z"),
};

const correctionReason =
  "Owner corrected the manager workflow: Kristy wants the five historical review prompts restored, and Don King Days is not assigned to her leg.";

export const REVIEW_PROMPT_RESTORATION_AUDIT_SQL = `
INSERT INTO audit_entries
  (entity_type, entity_id, action, before, after)
SELECT 'booking',
       restored.booking_id,
       'manager_review_prompt_restored',
       jsonb_build_object(
         'dismissed', true,
         'legId', $1::uuid,
         'reason', $3::text
       ),
       jsonb_build_object(
         'dismissed', false,
         'legId', $1::uuid
       )
  FROM unnest($2::uuid[]) AS restored(booking_id)
`;

export const DON_KING_UNASSIGNMENT_AUDIT_SQL = `
INSERT INTO audit_entries
  (entity_type, entity_id, action, before, after)
VALUES (
  'booking',
  $1::uuid,
  'incorrect_manager_leg_removed',
  jsonb_build_object(
    'travelLegId', $2::uuid,
    'status', 'new_lead',
    'reason', $3::text
  ),
  jsonb_build_object(
    'travelLegId', NULL::text,
    'status', 'new_lead'
  )
)
`;

function sameIdentity(actual: BookingIdentity, expected: BookingIdentity) {
  return actual.id === expected.id
    && actual.name === expected.name
    && actual.city === expected.city
    && actual.region === expected.region
    && actual.startsAt.toISOString() === expected.startsAt.toISOString()
    && actual.endsAt.toISOString() === expected.endsAt.toISOString();
}

function donKingState(
  inspection: DonKingInspection,
  kristyLegId: string,
): "unassigned" | "already_unassigned" | "assigned_elsewhere" {
  if (inspection.assignedLegId === kristyLegId) return "unassigned";
  if (inspection.assignedLegId === null) return "already_unassigned";
  return "assigned_elsewhere";
}

export async function correctKristyReviewState(
  repository: KristyReviewStateCorrectionRepository =
    new PostgresKristyReviewStateCorrectionRepository(),
): Promise<
  | {
      status: "applied" | "already_current";
      legId: string;
      restoredBookingIds: string[];
      donKingDays: "unassigned" | "already_unassigned" | "assigned_elsewhere";
    }
  | { status: "skipped"; reason: string; details?: unknown }
> {
  const legs = await repository.findKristyLegs();
  if (legs.length !== 1) {
    return {
      status: "skipped",
      reason: "manager_ambiguous",
      details: legs,
    };
  }

  const legId = legs[0]!.legId;
  const promptIds = KRISTY_REVIEW_PROMPT_BOOKINGS.map((booking) => booking.id);
  const prompts = await repository.inspectReviewPrompts(legId, promptIds);
  if (prompts.length !== KRISTY_REVIEW_PROMPT_BOOKINGS.length) {
    return {
      status: "skipped",
      reason: "review_identity_changed",
      details: { expected: promptIds, found: prompts.map((prompt) => prompt.id) },
    };
  }

  const promptById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  const changedPrompts = KRISTY_REVIEW_PROMPT_BOOKINGS.filter((expected) => {
    const actual = promptById.get(expected.id);
    return !actual
      || !sameIdentity(actual, expected)
      || actual.status !== expected.status
      || actual.assignedLegId !== legId;
  });
  if (changedPrompts.length > 0) {
    return {
      status: "skipped",
      reason: "review_identity_changed",
      details: changedPrompts.map((booking) => booking.id),
    };
  }

  const donKing = await repository.inspectDonKingDays(DON_KING_DAYS_BOOKING.id);
  if (!donKing || !sameIdentity(donKing, DON_KING_DAYS_BOOKING)) {
    return {
      status: "skipped",
      reason: "don_king_changed",
      details: donKing,
    };
  }

  if (donKing.assignedLegId === legId && donKing.status !== "new_lead") {
    return {
      status: "skipped",
      reason: "don_king_changed",
      details: { status: donKing.status, assignedLegId: donKing.assignedLegId },
    };
  }

  if (
    donKing.assignedLegId !== null
    && donKing.assignedLegId !== legId
    && donKing.persistedAssignmentLegId !== null
    && donKing.persistedAssignmentLegId !== donKing.assignedLegId
  ) {
    return {
      status: "skipped",
      reason: "don_king_changed",
      details: {
        assignedLegId: donKing.assignedLegId,
        persistedAssignmentLegId: donKing.persistedAssignmentLegId,
      },
    };
  }

  const restoreBookingIds = prompts
    .filter((prompt) => prompt.dismissalPresent)
    .map((prompt) => prompt.id);
  const unassignDonKing = donKing.assignedLegId === legId;
  const clearDonKingPersistedAssignment =
    donKing.persistedAssignmentLegId === legId;
  const state = donKingState(donKing, legId);

  if (
    restoreBookingIds.length === 0
    && !unassignDonKing
    && !clearDonKingPersistedAssignment
  ) {
    return {
      status: "already_current",
      legId,
      restoredBookingIds: [],
      donKingDays: state,
    };
  }

  const applied = await repository.applyCorrection({
    legId,
    restoreBookingIds,
    donKingBookingId: DON_KING_DAYS_BOOKING.id,
    unassignDonKing,
    clearDonKingPersistedAssignment,
    reason: correctionReason,
  });
  if (applied === "changed") {
    return {
      status: "skipped",
      reason: "state_changed_during_correction",
    };
  }

  return {
    status: applied,
    legId,
    restoredBookingIds: restoreBookingIds,
    donKingDays: state,
  };
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

type BookingRow = {
  id: string;
  name: string;
  city: string;
  region: string;
  starts_at: Date | string;
  ends_at: Date | string;
  status: string;
  travel_leg_id: string | null;
};

function rowIdentity(row: BookingRow): BookingIdentity {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    region: row.region,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
  };
}

export class PostgresKristyReviewStateCorrectionRepository
implements KristyReviewStateCorrectionRepository {
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

  async inspectReviewPrompts(
    legId: string,
    bookingIds: string[],
  ): Promise<ReviewPromptInspection[]> {
    const result = await this.database.query<BookingRow & {
      dismissal_present: boolean;
      review_count: number | string;
    }>(
      `SELECT booking.id,
              booking.name,
              booking.city,
              booking.region,
              booking.starts_at,
              booking.ends_at,
              booking.status::text AS status,
              booking.travel_leg_id,
              EXISTS (
                SELECT 1
                  FROM event_manager_review_dismissals dismissal
                 WHERE dismissal.booking_id = booking.id
                   AND dismissal.leg_id = $1
              ) AS dismissal_present,
              (
                SELECT count(*)::int
                  FROM event_manager_reviews review
                 WHERE review.booking_id = booking.id
                   AND review.leg_id = $1
              ) AS review_count
         FROM bookings booking
        WHERE booking.id = ANY($2::uuid[])
        ORDER BY booking.id`,
      [legId, bookingIds],
    );
    return result.rows.map((row) => ({
      ...rowIdentity(row),
      status: row.status as "confirmed",
      assignedLegId: row.travel_leg_id,
      dismissalPresent: row.dismissal_present,
      reviewCount: Number(row.review_count),
    }));
  }

  async inspectDonKingDays(bookingId: string): Promise<DonKingInspection | null> {
    const result = await this.database.query<BookingRow & {
      persisted_assignment_leg_id: string | null;
    }>(
      `SELECT booking.id,
              booking.name,
              booking.city,
              booking.region,
              booking.starts_at,
              booking.ends_at,
              booking.status::text AS status,
              booking.travel_leg_id,
              assignment.assigned_leg_id AS persisted_assignment_leg_id
         FROM bookings booking
         LEFT JOIN booking_leg_assignments assignment
           ON assignment.booking_id = booking.id
        WHERE booking.id = $1
        LIMIT 1`,
      [bookingId],
    );
    const row = result.rows[0];
    return row
      ? {
          ...rowIdentity(row),
          status: row.status,
          assignedLegId: row.travel_leg_id,
          persistedAssignmentLegId: row.persisted_assignment_leg_id,
        }
      : null;
  }

  async applyCorrection(input: {
    legId: string;
    restoreBookingIds: string[];
    donKingBookingId: string;
    unassignDonKing: boolean;
    clearDonKingPersistedAssignment: boolean;
    reason: string;
  }): Promise<"applied" | "already_current" | "changed"> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");

      const allIds = [
        ...KRISTY_REVIEW_PROMPT_BOOKINGS.map((booking) => booking.id),
        DON_KING_DAYS_BOOKING.id,
      ];
      const locked = await client.query<BookingRow>(
        `SELECT id,
                name,
                city,
                region,
                starts_at,
                ends_at,
                status::text AS status,
                travel_leg_id
           FROM bookings
          WHERE id = ANY($1::uuid[])
          ORDER BY id
          FOR UPDATE`,
        [allIds],
      );
      if (locked.rows.length !== allIds.length) {
        await client.query("ROLLBACK");
        return "changed";
      }

      const lockedById = new Map(locked.rows.map((row) => [row.id, row]));
      const promptsChanged = KRISTY_REVIEW_PROMPT_BOOKINGS.some((expected) => {
        const row = lockedById.get(expected.id);
        return !row
          || !sameIdentity(rowIdentity(row), expected)
          || row.status !== expected.status
          || row.travel_leg_id !== input.legId;
      });
      if (promptsChanged) {
        await client.query("ROLLBACK");
        return "changed";
      }

      const donKingRow = lockedById.get(DON_KING_DAYS_BOOKING.id);
      if (!donKingRow || !sameIdentity(rowIdentity(donKingRow), DON_KING_DAYS_BOOKING)) {
        await client.query("ROLLBACK");
        return "changed";
      }
      if (
        input.unassignDonKing
        && (donKingRow.travel_leg_id !== input.legId || donKingRow.status !== "new_lead")
      ) {
        await client.query("ROLLBACK");
        return "changed";
      }
      if (!input.unassignDonKing && donKingRow.travel_leg_id === input.legId) {
        await client.query("ROLLBACK");
        return "changed";
      }

      if (input.restoreBookingIds.length > 0) {
        const deleted = await client.query<{ booking_id: string }>(
          `DELETE FROM event_manager_review_dismissals
            WHERE leg_id = $1
              AND booking_id = ANY($2::uuid[])
          RETURNING booking_id`,
          [input.legId, input.restoreBookingIds],
        );
        if (deleted.rows.length !== input.restoreBookingIds.length) {
          await client.query("ROLLBACK");
          return "changed";
        }

        await client.query(REVIEW_PROMPT_RESTORATION_AUDIT_SQL, [
          input.legId,
          input.restoreBookingIds,
          input.reason,
        ]);
      }

      if (input.unassignDonKing) {
        const updated = await client.query<{ id: string }>(
          `UPDATE bookings
              SET travel_leg_id = NULL,
                  updated_at = now()
            WHERE id = $1
              AND travel_leg_id = $2
              AND status = 'new_lead'
          RETURNING id`,
          [input.donKingBookingId, input.legId],
        );
        if (updated.rows.length !== 1) {
          await client.query("ROLLBACK");
          return "changed";
        }
        await client.query(DON_KING_UNASSIGNMENT_AUDIT_SQL, [
          input.donKingBookingId,
          input.legId,
          input.reason,
        ]);
      }

      if (input.clearDonKingPersistedAssignment) {
        const deletedAssignment = await client.query<{ booking_id: string }>(
          `DELETE FROM booking_leg_assignments
            WHERE booking_id = $1
              AND assigned_leg_id = $2
          RETURNING booking_id`,
          [input.donKingBookingId, input.legId],
        );
        if (deletedAssignment.rows.length !== 1) {
          await client.query("ROLLBACK");
          return "changed";
        }
      }

      const remainingDismissals = input.restoreBookingIds.length > 0
        ? await client.query<{ booking_id: string }>(
            `SELECT booking_id
               FROM event_manager_review_dismissals
              WHERE leg_id = $1
                AND booking_id = ANY($2::uuid[])`,
            [input.legId, input.restoreBookingIds],
          )
        : { rows: [] as { booking_id: string }[] };
      if (remainingDismissals.rows.length > 0) {
        await client.query("ROLLBACK");
        return "changed";
      }

      const finalDonKing = await client.query<{
        travel_leg_id: string | null;
        assigned_leg_id: string | null;
      }>(
        `SELECT booking.travel_leg_id,
                assignment.assigned_leg_id
           FROM bookings booking
           LEFT JOIN booking_leg_assignments assignment
             ON assignment.booking_id = booking.id
          WHERE booking.id = $1`,
        [input.donKingBookingId],
      );
      const final = finalDonKing.rows[0];
      if (
        !final
        || (input.unassignDonKing && final.travel_leg_id === input.legId)
        || (
          input.clearDonKingPersistedAssignment
          && final.assigned_leg_id === input.legId
        )
      ) {
        await client.query("ROLLBACK");
        return "changed";
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
