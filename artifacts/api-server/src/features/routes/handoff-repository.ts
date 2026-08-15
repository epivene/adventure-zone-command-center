import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";

export type HandoffStatus = "suggested" | "dismissed" | "approved" | "needs_review";
export type HandoffOpportunityBand = "strong" | "possible" | "weak";

export type EquipmentHandoff = {
  id: string;
  status: HandoffStatus;
  fromLegId: string;
  toLegId: string;
  fromTripId: string | null;
  toTripId: string | null;
  resourceId: string;
  resourceCode: string | null;
  resourceName: string | null;
  meetupLabel: string;
  meetupLatitude: number;
  meetupLongitude: number;
  windowStartsAt: Date;
  windowEndsAt: Date;
  directMiles: number | null;
  directMinutes: number | null;
  fromDetourMiles: number;
  fromDetourMinutes: number;
  toDetourMiles: number;
  toDetourMinutes: number;
  combinedDetourMiles: number;
  availableBufferMinutes: number | null;
  opportunityBand: HandoffOpportunityBand;
  explanation: string;
  dependencyFingerprint: string;
  approvedAt: Date | null;
  dismissedAt: Date | null;
};

export type HandoffSuggestionInput = Omit<
  EquipmentHandoff,
  | "id"
  | "status"
  | "resourceCode"
  | "resourceName"
  | "approvedAt"
  | "dismissedAt"
>;

export type ApprovedTripHandoff = {
  id: string;
  tripId: string;
  direction: "release" | "receive";
  label: string;
  latitude: number;
  longitude: number;
  windowStartsAt: Date;
  windowEndsAt: Date;
  resourceName: string;
};

type DrizzleDatabase = typeof database;

function rows<T>(value: unknown): T[] {
  return ((value as { rows?: T[] }).rows ?? []) as T[];
}

const ensureSql = sql.raw(`
create table if not exists equipment_handoffs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'suggested' check (status in ('suggested','dismissed','approved','needs_review')),
  from_leg_id uuid not null references travel_legs(id) on delete restrict,
  to_leg_id uuid not null references travel_legs(id) on delete restrict,
  from_trip_id uuid references trips(id) on delete set null,
  to_trip_id uuid references trips(id) on delete set null,
  resource_id uuid not null references resources(id) on delete restrict,
  meetup_label text not null,
  meetup_latitude double precision not null,
  meetup_longitude double precision not null,
  window_starts_at timestamptz not null,
  window_ends_at timestamptz not null,
  from_previous_booking_id uuid references bookings(id) on delete set null,
  from_next_booking_id uuid references bookings(id) on delete set null,
  to_previous_booking_id uuid references bookings(id) on delete set null,
  to_next_booking_id uuid references bookings(id) on delete set null,
  direct_miles double precision,
  direct_minutes double precision,
  from_detour_miles double precision not null default 0,
  from_detour_minutes double precision not null default 0,
  to_detour_miles double precision not null default 0,
  to_detour_minutes double precision not null default 0,
  combined_detour_miles double precision not null default 0,
  available_buffer_minutes double precision,
  opportunity_band text not null check (opportunity_band in ('strong','possible','weak')),
  explanation text not null,
  dependency_fingerprint text not null,
  approved_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_leg_id <> to_leg_id),
  check (window_ends_at >= window_starts_at)
);
create unique index if not exists equipment_handoffs_fingerprint_unique on equipment_handoffs(dependency_fingerprint);
create index if not exists equipment_handoffs_status_window_idx on equipment_handoffs(status, window_starts_at);
create index if not exists equipment_handoffs_from_trip_idx on equipment_handoffs(from_trip_id);
create index if not exists equipment_handoffs_to_trip_idx on equipment_handoffs(to_trip_id);
`);

export class HandoffRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async ensureSchema(): Promise<void> {
    await this.database.execute(ensureSql);
  }

  private async selectOne(id: string): Promise<EquipmentHandoff | null> {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select h.id, h.status,
        h.from_leg_id as "fromLegId", h.to_leg_id as "toLegId",
        h.from_trip_id as "fromTripId", h.to_trip_id as "toTripId",
        h.resource_id as "resourceId", r.code as "resourceCode", r.name as "resourceName",
        h.meetup_label as "meetupLabel", h.meetup_latitude as "meetupLatitude", h.meetup_longitude as "meetupLongitude",
        h.window_starts_at as "windowStartsAt", h.window_ends_at as "windowEndsAt",
        h.direct_miles as "directMiles", h.direct_minutes as "directMinutes",
        h.from_detour_miles as "fromDetourMiles", h.from_detour_minutes as "fromDetourMinutes",
        h.to_detour_miles as "toDetourMiles", h.to_detour_minutes as "toDetourMinutes",
        h.combined_detour_miles as "combinedDetourMiles", h.available_buffer_minutes as "availableBufferMinutes",
        h.opportunity_band as "opportunityBand", h.explanation,
        h.dependency_fingerprint as "dependencyFingerprint", h.approved_at as "approvedAt", h.dismissed_at as "dismissedAt"
      from equipment_handoffs h
      join resources r on r.id = h.resource_id
      where h.id = ${id}::uuid
      limit 1
    `);
    return rows<EquipmentHandoff>(result)[0] ?? null;
  }

  async get(id: string): Promise<EquipmentHandoff | null> {
    return this.selectOne(id);
  }

  async listForSeason(year: number): Promise<EquipmentHandoff[]> {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select h.id, h.status,
        h.from_leg_id as "fromLegId", h.to_leg_id as "toLegId",
        h.from_trip_id as "fromTripId", h.to_trip_id as "toTripId",
        h.resource_id as "resourceId", r.code as "resourceCode", r.name as "resourceName",
        h.meetup_label as "meetupLabel", h.meetup_latitude as "meetupLatitude", h.meetup_longitude as "meetupLongitude",
        h.window_starts_at as "windowStartsAt", h.window_ends_at as "windowEndsAt",
        h.direct_miles as "directMiles", h.direct_minutes as "directMinutes",
        h.from_detour_miles as "fromDetourMiles", h.from_detour_minutes as "fromDetourMinutes",
        h.to_detour_miles as "toDetourMiles", h.to_detour_minutes as "toDetourMinutes",
        h.combined_detour_miles as "combinedDetourMiles", h.available_buffer_minutes as "availableBufferMinutes",
        h.opportunity_band as "opportunityBand", h.explanation,
        h.dependency_fingerprint as "dependencyFingerprint", h.approved_at as "approvedAt", h.dismissed_at as "dismissedAt"
      from equipment_handoffs h
      join resources r on r.id = h.resource_id
      where extract(year from h.window_starts_at) = ${year}
      order by
        case h.status when 'approved' then 0 when 'suggested' then 1 when 'needs_review' then 2 else 3 end,
        case h.opportunity_band when 'strong' then 0 when 'possible' then 1 else 2 end,
        h.window_starts_at asc
    `);
    return rows<EquipmentHandoff>(result);
  }

  async upsertSuggestion(input: HandoffSuggestionInput): Promise<EquipmentHandoff> {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      insert into equipment_handoffs (
        status, from_leg_id, to_leg_id, from_trip_id, to_trip_id, resource_id,
        meetup_label, meetup_latitude, meetup_longitude, window_starts_at, window_ends_at,
        direct_miles, direct_minutes, from_detour_miles, from_detour_minutes,
        to_detour_miles, to_detour_minutes, combined_detour_miles, available_buffer_minutes,
        opportunity_band, explanation, dependency_fingerprint, updated_at
      ) values (
        'suggested', ${input.fromLegId}::uuid, ${input.toLegId}::uuid,
        ${input.fromTripId}::uuid, ${input.toTripId}::uuid, ${input.resourceId}::uuid,
        ${input.meetupLabel}, ${input.meetupLatitude}, ${input.meetupLongitude},
        ${input.windowStartsAt}, ${input.windowEndsAt}, ${input.directMiles}, ${input.directMinutes},
        ${input.fromDetourMiles}, ${input.fromDetourMinutes}, ${input.toDetourMiles}, ${input.toDetourMinutes},
        ${input.combinedDetourMiles}, ${input.availableBufferMinutes}, ${input.opportunityBand},
        ${input.explanation}, ${input.dependencyFingerprint}, now()
      )
      on conflict (dependency_fingerprint) do update set
        meetup_label = excluded.meetup_label,
        meetup_latitude = excluded.meetup_latitude,
        meetup_longitude = excluded.meetup_longitude,
        window_starts_at = excluded.window_starts_at,
        window_ends_at = excluded.window_ends_at,
        direct_miles = excluded.direct_miles,
        direct_minutes = excluded.direct_minutes,
        from_detour_miles = excluded.from_detour_miles,
        from_detour_minutes = excluded.from_detour_minutes,
        to_detour_miles = excluded.to_detour_miles,
        to_detour_minutes = excluded.to_detour_minutes,
        combined_detour_miles = excluded.combined_detour_miles,
        available_buffer_minutes = excluded.available_buffer_minutes,
        opportunity_band = excluded.opportunity_band,
        explanation = excluded.explanation,
        status = case when equipment_handoffs.status in ('approved','dismissed') then equipment_handoffs.status else 'suggested' end,
        updated_at = now()
      returning id
    `);
    const id = rows<{ id: string }>(result)[0]?.id;
    if (!id) throw new Error("Handoff suggestion could not be saved.");
    const saved = await this.selectOne(id);
    if (!saved) throw new Error("Handoff suggestion could not be loaded.");
    return saved;
  }

  async markUnrefreshedNeedsReview(year: number, fingerprints: string[]): Promise<void> {
    await this.ensureSchema();
    if (fingerprints.length === 0) {
      await this.database.execute(sql`
        update equipment_handoffs set status = 'needs_review', updated_at = now()
        where status = 'suggested' and extract(year from window_starts_at) = ${year}
      `);
      return;
    }
    const quoted = fingerprints.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");
    await this.database.execute(sql.raw(`
      update equipment_handoffs set status = 'needs_review', updated_at = now()
      where status = 'suggested'
        and extract(year from window_starts_at) = ${Number(year)}
        and dependency_fingerprint not in (${quoted})
    `));
  }

  async approve(id: string): Promise<EquipmentHandoff | null> {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      update equipment_handoffs
      set status = 'approved', approved_at = now(), dismissed_at = null, updated_at = now()
      where id = ${id}::uuid and status in ('suggested','needs_review')
      returning id
    `);
    const updatedId = rows<{ id: string }>(result)[0]?.id;
    return updatedId ? this.selectOne(updatedId) : null;
  }

  async dismiss(id: string): Promise<EquipmentHandoff | null> {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      update equipment_handoffs
      set status = 'dismissed', dismissed_at = now(), updated_at = now()
      where id = ${id}::uuid and status <> 'approved'
      returning id
    `);
    const updatedId = rows<{ id: string }>(result)[0]?.id;
    return updatedId ? this.selectOne(updatedId) : null;
  }

  async listApprovedForTrip(tripId: string): Promise<ApprovedTripHandoff[]> {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select h.id,
        case when h.from_trip_id = ${tripId}::uuid then 'release' else 'receive' end as direction,
        ${tripId}::uuid as "tripId",
        h.meetup_label as label, h.meetup_latitude as latitude, h.meetup_longitude as longitude,
        h.window_starts_at as "windowStartsAt", h.window_ends_at as "windowEndsAt",
        r.name as "resourceName"
      from equipment_handoffs h
      join resources r on r.id = h.resource_id
      where h.status = 'approved'
        and (h.from_trip_id = ${tripId}::uuid or h.to_trip_id = ${tripId}::uuid)
      order by h.window_starts_at asc, h.id asc
    `);
    return rows<ApprovedTripHandoff>(result);
  }
}
