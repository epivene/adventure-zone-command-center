import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import type {
  EventOverheadAllocation,
  EventProfitAdjustment,
  EventTravelAllocationOverride,
  EventWrapUp,
  EventWrapUpDraftInput,
  EventWrapUpStore,
} from "./event-wrap-up-service";

type DrizzleDatabase = typeof database;
function resultRows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
function asDate(value: unknown): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(String(value));
}
function normalizeWrapUp(row: any): EventWrapUp {
  return {
    ...row,
    ratingStars: row.ratingStars == null ? null : Number(row.ratingStars),
    actualCashOnHandCents: row.actualCashOnHandCents == null ? null : Number(row.actualCashOnHandCents),
    submittedAt: asDate(row.submittedAt),
    reviewedAt: asDate(row.reviewedAt),
    createdAt: asDate(row.createdAt)!,
    updatedAt: asDate(row.updatedAt)!,
  };
}

const ensureSql = sql.raw(`
create table if not exists event_wrap_ups (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id) on delete cascade,
  leg_id uuid not null references travel_legs(id) on delete restrict,
  trip_id uuid references trips(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','submitted','reviewed')),
  rating_stars integer check (rating_stars between 0 and 5),
  rating_notes text,
  actual_cash_on_hand_cents integer check (actual_cash_on_hand_cents is null or actual_cash_on_hand_cents >= 0),
  cash_difference_note text,
  submitted_at timestamptz,
  submitted_by text,
  reviewed_at timestamptz,
  reviewed_by text,
  reviewed_source_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists event_wrap_ups_status_updated_idx on event_wrap_ups(status, updated_at desc);
create index if not exists event_wrap_ups_leg_updated_idx on event_wrap_ups(leg_id, updated_at desc);

create table if not exists event_wrap_up_audit (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  action text not null,
  actor text,
  created_at timestamptz not null default now()
);
create index if not exists event_wrap_up_audit_booking_idx on event_wrap_up_audit(booking_id, created_at desc);

create table if not exists event_travel_allocation_overrides (
  booking_id uuid not null references bookings(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  automatic_miles numeric(10,2) not null,
  override_miles numeric(10,2),
  override_cost_cents integer,
  reason text not null check (length(trim(reason)) > 0),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (booking_id, trip_id)
);

create table if not exists event_overhead_allocations (
  booking_id uuid primary key references bookings(id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  label text not null,
  reason text not null check (length(trim(reason)) > 0),
  updated_by text not null,
  updated_at timestamptz not null default now()
);

create table if not exists event_profit_adjustments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  scope text not null check (scope in ('direct','true_profit')),
  amount_cents integer not null,
  label text not null,
  reason text not null check (length(trim(reason)) > 0),
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists event_profit_adjustments_booking_idx on event_profit_adjustments(booking_id, created_at asc);
`);

const wrapSelection = sql.raw(`
  id,
  booking_id as "bookingId",
  leg_id as "legId",
  trip_id as "tripId",
  status,
  rating_stars as "ratingStars",
  rating_notes as "ratingNotes",
  actual_cash_on_hand_cents as "actualCashOnHandCents",
  cash_difference_note as "cashDifferenceNote",
  submitted_at as "submittedAt",
  submitted_by as "submittedBy",
  reviewed_at as "reviewedAt",
  reviewed_by as "reviewedBy",
  reviewed_source_fingerprint as "reviewedSourceFingerprint",
  created_at as "createdAt",
  updated_at as "updatedAt"
`);

export class DrizzleEventWrapUpRepository implements EventWrapUpStore {
  constructor(private readonly database: DrizzleDatabase) {}

  async ensureSchema() {
    await this.database.execute(ensureSql);
  }

  private async audit(bookingId: string, action: string, actor: string | null) {
    await this.database.execute(sql`
      insert into event_wrap_up_audit (booking_id, action, actor)
      values (${bookingId}::uuid, ${action}, ${actor})
    `);
  }

  async get(bookingId: string) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select ${wrapSelection} from event_wrap_ups where booking_id=${bookingId}::uuid limit 1
    `);
    const row = resultRows<any>(result)[0];
    return row ? normalizeWrapUp(row) : null;
  }

  async saveDraft(input: EventWrapUpDraftInput & { bookingId: string; legId: string; tripId: string | null }) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      insert into event_wrap_ups (
        booking_id, leg_id, trip_id, rating_stars, rating_notes,
        actual_cash_on_hand_cents, cash_difference_note
      ) values (
        ${input.bookingId}::uuid, ${input.legId}::uuid, ${input.tripId}::uuid,
        ${input.ratingStars}, ${input.ratingNotes}, ${input.actualCashOnHandCents}, ${input.cashDifferenceNote}
      )
      on conflict (booking_id) do update set
        leg_id=excluded.leg_id,
        trip_id=excluded.trip_id,
        rating_stars=excluded.rating_stars,
        rating_notes=excluded.rating_notes,
        actual_cash_on_hand_cents=excluded.actual_cash_on_hand_cents,
        cash_difference_note=excluded.cash_difference_note,
        updated_at=now()
      returning ${wrapSelection}
    `);
    const row = resultRows<any>(result)[0];
    if (!row) throw new Error("Event wrap-up could not be saved");
    return normalizeWrapUp(row);
  }

  private async transition(
    bookingId: string,
    from: "draft" | "submitted" | "reviewed",
    setSql: ReturnType<typeof sql.raw>,
  ) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      update event_wrap_ups set ${setSql}, updated_at=now()
      where booking_id=${bookingId}::uuid and status=${from}
      returning ${wrapSelection}
    `);
    const row = resultRows<any>(result)[0];
    return row ? normalizeWrapUp(row) : null;
  }

  async markSubmitted(bookingId: string, submittedBy: string | null) {
    const actor = submittedBy?.replaceAll("'", "''") ?? null;
    const row = await this.transition(
      bookingId,
      "draft",
      sql.raw(`status='submitted', submitted_at=now(), submitted_by=${actor ? `'${actor}'` : "null"}`),
    );
    if (row) await this.audit(bookingId, "submitted", submittedBy);
    return row;
  }

  async markReviewed(bookingId: string, reviewedBy: string | null, sourceFingerprint: string) {
    const actor = reviewedBy?.replaceAll("'", "''") ?? null;
    const fingerprint = sourceFingerprint.replaceAll("'", "''");
    const row = await this.transition(
      bookingId,
      "submitted",
      sql.raw(`status='reviewed', reviewed_at=now(), reviewed_by=${actor ? `'${actor}'` : "null"}, reviewed_source_fingerprint='${fingerprint}'`),
    );
    if (row) await this.audit(bookingId, "reviewed", reviewedBy);
    return row;
  }

  async reopen(bookingId: string, actor: string | null) {
    const row = await this.transition(
      bookingId,
      "reviewed",
      sql.raw("status='draft', reviewed_at=null, reviewed_by=null"),
    );
    if (row) await this.audit(bookingId, "reopened", actor);
    return row;
  }

  async listSubmitted() {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select ${wrapSelection} from event_wrap_ups where status='submitted' order by submitted_at asc nulls last, updated_at asc
    `);
    return resultRows<any>(result).map(normalizeWrapUp);
  }

  async averageRatingForFamily(familyId: string) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select avg(w.rating_stars)::float as average, count(w.rating_stars)::int as count
      from event_wrap_ups w
      inner join bookings b on b.id=w.booking_id
      inner join event_family_members m on m.organization_id=b.organization_id
      where m.family_id=${familyId}::uuid and w.rating_stars is not null
    `);
    const row = resultRows<any>(result)[0];
    return {
      average: row?.average == null ? null : Number(row.average),
      count: Number(row?.count ?? 0),
    };
  }

  async getTravelOverride(bookingId: string, tripId: string) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select booking_id as "bookingId", trip_id as "tripId", automatic_miles as "automaticMiles",
        override_miles as "overrideMiles", override_cost_cents as "overrideCostCents", reason,
        updated_by as "updatedBy", updated_at as "updatedAt"
      from event_travel_allocation_overrides
      where booking_id=${bookingId}::uuid and trip_id=${tripId}::uuid limit 1
    `);
    const row = resultRows<any>(result)[0];
    return row ? {
      ...row,
      automaticMiles: Number(row.automaticMiles),
      overrideMiles: row.overrideMiles == null ? null : Number(row.overrideMiles),
      overrideCostCents: row.overrideCostCents == null ? null : Number(row.overrideCostCents),
      updatedAt: asDate(row.updatedAt)!,
    } as EventTravelAllocationOverride : null;
  }

  async saveTravelOverride(input: Omit<EventTravelAllocationOverride, "updatedAt">) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      insert into event_travel_allocation_overrides
        (booking_id, trip_id, automatic_miles, override_miles, override_cost_cents, reason, updated_by)
      values (${input.bookingId}::uuid, ${input.tripId}::uuid, ${input.automaticMiles}, ${input.overrideMiles}, ${input.overrideCostCents}, ${input.reason.trim()}, ${input.updatedBy})
      on conflict (booking_id, trip_id) do update set
        automatic_miles=excluded.automatic_miles,
        override_miles=excluded.override_miles,
        override_cost_cents=excluded.override_cost_cents,
        reason=excluded.reason,
        updated_by=excluded.updated_by,
        updated_at=now()
      returning booking_id as "bookingId", trip_id as "tripId", automatic_miles as "automaticMiles",
        override_miles as "overrideMiles", override_cost_cents as "overrideCostCents", reason,
        updated_by as "updatedBy", updated_at as "updatedAt"
    `);
    const row = resultRows<any>(result)[0];
    if (!row) throw new Error("Travel allocation override could not be saved");
    return {
      ...row,
      automaticMiles: Number(row.automaticMiles),
      overrideMiles: row.overrideMiles == null ? null : Number(row.overrideMiles),
      overrideCostCents: row.overrideCostCents == null ? null : Number(row.overrideCostCents),
      updatedAt: asDate(row.updatedAt)!,
    } as EventTravelAllocationOverride;
  }

  async getOverhead(bookingId: string) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select booking_id as "bookingId", amount_cents as "amountCents", label, reason,
        updated_by as "updatedBy", updated_at as "updatedAt"
      from event_overhead_allocations where booking_id=${bookingId}::uuid limit 1
    `);
    const row = resultRows<any>(result)[0];
    return row ? { ...row, amountCents: Number(row.amountCents), updatedAt: asDate(row.updatedAt)! } as EventOverheadAllocation : null;
  }

  async saveOverhead(input: Omit<EventOverheadAllocation, "updatedAt">) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      insert into event_overhead_allocations (booking_id, amount_cents, label, reason, updated_by)
      values (${input.bookingId}::uuid, ${input.amountCents}, ${input.label.trim()}, ${input.reason.trim()}, ${input.updatedBy})
      on conflict (booking_id) do update set amount_cents=excluded.amount_cents, label=excluded.label,
        reason=excluded.reason, updated_by=excluded.updated_by, updated_at=now()
      returning booking_id as "bookingId", amount_cents as "amountCents", label, reason,
        updated_by as "updatedBy", updated_at as "updatedAt"
    `);
    const row = resultRows<any>(result)[0];
    if (!row) throw new Error("Overhead allocation could not be saved");
    return { ...row, amountCents: Number(row.amountCents), updatedAt: asDate(row.updatedAt)! } as EventOverheadAllocation;
  }

  async listAdjustments(bookingId: string) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select id, booking_id as "bookingId", scope, amount_cents as "amountCents", label, reason,
        created_by as "createdBy", created_at as "createdAt"
      from event_profit_adjustments where booking_id=${bookingId}::uuid order by created_at asc
    `);
    return resultRows<any>(result).map((row) => ({
      ...row,
      amountCents: Number(row.amountCents),
      createdAt: asDate(row.createdAt)!,
    })) as EventProfitAdjustment[];
  }

  async addAdjustment(input: Omit<EventProfitAdjustment, "id" | "createdAt">) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      insert into event_profit_adjustments (booking_id, scope, amount_cents, label, reason, created_by)
      values (${input.bookingId}::uuid, ${input.scope}, ${input.amountCents}, ${input.label.trim()}, ${input.reason.trim()}, ${input.createdBy})
      returning id, booking_id as "bookingId", scope, amount_cents as "amountCents", label, reason,
        created_by as "createdBy", created_at as "createdAt"
    `);
    const row = resultRows<any>(result)[0];
    if (!row) throw new Error("Profit adjustment could not be saved");
    return { ...row, amountCents: Number(row.amountCents), createdAt: asDate(row.createdAt)! } as EventProfitAdjustment;
  }

  async deleteAdjustment(bookingId: string, adjustmentId: string) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      delete from event_profit_adjustments where id=${adjustmentId}::uuid and booking_id=${bookingId}::uuid returning id
    `);
    return resultRows<any>(result).length > 0;
  }
}
