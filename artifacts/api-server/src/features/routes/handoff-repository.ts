import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";

export type HandoffStatus = "suggested" | "dismissed" | "approved" | "needs_review";
export type HandoffOpportunityBand = "strong" | "possible" | "weak";

export type MeetupParticipant =
  | { kind: "leg"; legId: string; legName: string }
  | {
      kind: "external_contact";
      externalContactId: string | null;
      displayName: string;
      phone: string | null;
      email: string | null;
    };

export type MeetupParticipantInput =
  | { kind: "leg"; legId: string }
  | {
      kind: "external_contact";
      externalContactId: string | null;
      displayName: string;
      phone: string | null;
      email: string | null;
    };

export type EquipmentHandoff = {
  id: string;
  status: HandoffStatus;
  fromLegId: string | null;
  toLegId: string | null;
  fromParticipant: MeetupParticipant;
  toParticipant: MeetupParticipant;
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

export type HandoffSuggestionInput = {
  fromLegId: string;
  toLegId: string;
  fromTripId: string | null;
  toTripId: string | null;
  resourceId: string;
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
};

export type ManualHandoffInput = {
  fromParticipant: MeetupParticipantInput;
  toParticipant: MeetupParticipantInput;
  fromTripId: string | null;
  toTripId: string | null;
  resourceId: string;
  meetupLabel: string;
  meetupLatitude: number;
  meetupLongitude: number;
  windowStartsAt: Date;
  windowEndsAt: Date;
};

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

type RawHandoffRow = Omit<EquipmentHandoff, "fromParticipant" | "toParticipant"> & {
  fromLegName: string | null;
  toLegName: string | null;
  fromParticipantKind: "leg" | "external_contact";
  toParticipantKind: "leg" | "external_contact";
  fromExternalContactId: string | null;
  fromExternalName: string | null;
  fromExternalPhone: string | null;
  fromExternalEmail: string | null;
  toExternalContactId: string | null;
  toExternalName: string | null;
  toExternalPhone: string | null;
  toExternalEmail: string | null;
};

function rows<T>(value: unknown): T[] {
  return ((value as { rows?: T[] }).rows ?? []) as T[];
}

function participantFromRow(row: RawHandoffRow, side: "from" | "to"): MeetupParticipant {
  const kind = side === "from" ? row.fromParticipantKind : row.toParticipantKind;
  if (kind === "leg") {
    const legId = side === "from" ? row.fromLegId : row.toLegId;
    const legName = side === "from" ? row.fromLegName : row.toLegName;
    if (!legId) throw new Error("Equipment handoff leg participant is missing its leg id.");
    return { kind: "leg", legId, legName: legName ?? "Leg" };
  }
  return {
    kind: "external_contact",
    externalContactId: side === "from" ? row.fromExternalContactId : row.toExternalContactId,
    displayName: (side === "from" ? row.fromExternalName : row.toExternalName) ?? "Outside runner",
    phone: side === "from" ? row.fromExternalPhone : row.toExternalPhone,
    email: side === "from" ? row.fromExternalEmail : row.toExternalEmail,
  };
}

function normalizeRow(row: RawHandoffRow): EquipmentHandoff {
  const {
    fromLegName: _fromLegName,
    toLegName: _toLegName,
    fromParticipantKind: _fromParticipantKind,
    toParticipantKind: _toParticipantKind,
    fromExternalContactId: _fromExternalContactId,
    fromExternalName: _fromExternalName,
    fromExternalPhone: _fromExternalPhone,
    fromExternalEmail: _fromExternalEmail,
    toExternalContactId: _toExternalContactId,
    toExternalName: _toExternalName,
    toExternalPhone: _toExternalPhone,
    toExternalEmail: _toExternalEmail,
    ...base
  } = row;
  return {
    ...base,
    fromParticipant: participantFromRow(row, "from"),
    toParticipant: participantFromRow(row, "to"),
  };
}

function validateParticipants(from: MeetupParticipantInput, to: MeetupParticipantInput): void {
  if (from.kind !== "leg" && to.kind !== "leg") {
    throw new Error("At least one equipment meetup participant must be an Adventure Zone leg.");
  }
  for (const participant of [from, to]) {
    if (participant.kind === "external_contact" && !participant.displayName.trim()) {
      throw new Error("Outside runner name is required.");
    }
  }
  if (from.kind === "leg" && to.kind === "leg" && from.legId === to.legId) {
    throw new Error("Equipment meetup participants must be different.");
  }
}

function participantValues(participant: MeetupParticipantInput) {
  return participant.kind === "leg"
    ? {
        kind: "leg" as const,
        legId: participant.legId,
        externalContactId: null,
        externalName: null,
        externalPhone: null,
        externalEmail: null,
      }
    : {
        kind: "external_contact" as const,
        legId: null,
        externalContactId: participant.externalContactId,
        externalName: participant.displayName.trim(),
        externalPhone: participant.phone,
        externalEmail: participant.email,
      };
}

const ensureSql = sql.raw(`
create table if not exists equipment_handoffs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'suggested' check (status in ('suggested','dismissed','approved','needs_review')),
  from_leg_id uuid references travel_legs(id) on delete restrict,
  to_leg_id uuid references travel_legs(id) on delete restrict,
  from_participant_kind text not null default 'leg',
  to_participant_kind text not null default 'leg',
  from_external_contact_id uuid,
  from_external_name text,
  from_external_phone text,
  from_external_email text,
  to_external_contact_id uuid,
  to_external_name text,
  to_external_phone text,
  to_external_email text,
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
alter table equipment_handoffs alter column from_leg_id drop not null;
alter table equipment_handoffs alter column to_leg_id drop not null;
alter table equipment_handoffs add column if not exists from_participant_kind text not null default 'leg';
alter table equipment_handoffs add column if not exists to_participant_kind text not null default 'leg';
alter table equipment_handoffs add column if not exists from_external_contact_id uuid;
alter table equipment_handoffs add column if not exists from_external_name text;
alter table equipment_handoffs add column if not exists from_external_phone text;
alter table equipment_handoffs add column if not exists from_external_email text;
alter table equipment_handoffs add column if not exists to_external_contact_id uuid;
alter table equipment_handoffs add column if not exists to_external_name text;
alter table equipment_handoffs add column if not exists to_external_phone text;
alter table equipment_handoffs add column if not exists to_external_email text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'equipment_handoffs_from_participant_check') then
    alter table equipment_handoffs add constraint equipment_handoffs_from_participant_check check (
      (from_participant_kind = 'leg' and from_leg_id is not null)
      or (from_participant_kind = 'external_contact' and from_leg_id is null and nullif(trim(from_external_name), '') is not null)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'equipment_handoffs_to_participant_check') then
    alter table equipment_handoffs add constraint equipment_handoffs_to_participant_check check (
      (to_participant_kind = 'leg' and to_leg_id is not null)
      or (to_participant_kind = 'external_contact' and to_leg_id is null and nullif(trim(to_external_name), '') is not null)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'equipment_handoffs_participant_kind_check') then
    alter table equipment_handoffs add constraint equipment_handoffs_participant_kind_check check (
      from_participant_kind in ('leg','external_contact') and to_participant_kind in ('leg','external_contact')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'equipment_handoffs_requires_leg_check') then
    alter table equipment_handoffs add constraint equipment_handoffs_requires_leg_check check (
      from_participant_kind = 'leg' or to_participant_kind = 'leg'
    );
  end if;
end $$;

create unique index if not exists equipment_handoffs_fingerprint_unique on equipment_handoffs(dependency_fingerprint);
create index if not exists equipment_handoffs_status_window_idx on equipment_handoffs(status, window_starts_at);
create index if not exists equipment_handoffs_from_trip_idx on equipment_handoffs(from_trip_id);
create index if not exists equipment_handoffs_to_trip_idx on equipment_handoffs(to_trip_id);
create index if not exists equipment_handoffs_from_leg_idx on equipment_handoffs(from_leg_id);
create index if not exists equipment_handoffs_to_leg_idx on equipment_handoffs(to_leg_id);
`);

const selectColumns = sql.raw(`
  h.id, h.status,
  h.from_leg_id as "fromLegId", h.to_leg_id as "toLegId",
  fl.name as "fromLegName", tl.name as "toLegName",
  h.from_participant_kind as "fromParticipantKind", h.to_participant_kind as "toParticipantKind",
  h.from_external_contact_id as "fromExternalContactId", h.from_external_name as "fromExternalName",
  h.from_external_phone as "fromExternalPhone", h.from_external_email as "fromExternalEmail",
  h.to_external_contact_id as "toExternalContactId", h.to_external_name as "toExternalName",
  h.to_external_phone as "toExternalPhone", h.to_external_email as "toExternalEmail",
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
`);

export class HandoffRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async ensureSchema(): Promise<void> {
    await this.database.execute(ensureSql);
  }

  private async selectOne(id: string): Promise<EquipmentHandoff | null> {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select ${selectColumns}
      from equipment_handoffs h
      join resources r on r.id = h.resource_id
      left join travel_legs fl on fl.id = h.from_leg_id
      left join travel_legs tl on tl.id = h.to_leg_id
      where h.id = ${id}::uuid
      limit 1
    `);
    const row = rows<RawHandoffRow>(result)[0];
    return row ? normalizeRow(row) : null;
  }

  async get(id: string): Promise<EquipmentHandoff | null> {
    return this.selectOne(id);
  }

  async listForSeason(year: number): Promise<EquipmentHandoff[]> {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select ${selectColumns}
      from equipment_handoffs h
      join resources r on r.id = h.resource_id
      left join travel_legs fl on fl.id = h.from_leg_id
      left join travel_legs tl on tl.id = h.to_leg_id
      where extract(year from h.window_starts_at) = ${year}
      order by
        case h.status when 'approved' then 0 when 'suggested' then 1 when 'needs_review' then 2 else 3 end,
        case h.opportunity_band when 'strong' then 0 when 'possible' then 1 else 2 end,
        h.window_starts_at asc
    `);
    return rows<RawHandoffRow>(result).map(normalizeRow);
  }

  async listForLeg(legId: string, options: { approvedOnly?: boolean } = {}): Promise<EquipmentHandoff[]> {
    await this.ensureSchema();
    const statusClause = options.approvedOnly ? sql`and h.status = 'approved'` : sql``;
    const result = await this.database.execute(sql`
      select ${selectColumns}
      from equipment_handoffs h
      join resources r on r.id = h.resource_id
      left join travel_legs fl on fl.id = h.from_leg_id
      left join travel_legs tl on tl.id = h.to_leg_id
      where (h.from_leg_id = ${legId}::uuid or h.to_leg_id = ${legId}::uuid)
      ${statusClause}
      order by h.window_starts_at asc, h.id asc
    `);
    return rows<RawHandoffRow>(result).map(normalizeRow);
  }

  async createManual(input: ManualHandoffInput): Promise<EquipmentHandoff> {
    validateParticipants(input.fromParticipant, input.toParticipant);
    if (input.windowEndsAt < input.windowStartsAt) throw new Error("Meetup end time cannot be before its start time.");
    const from = participantValues(input.fromParticipant);
    const to = participantValues(input.toParticipant);
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      insert into equipment_handoffs (
        status, from_leg_id, to_leg_id, from_participant_kind, to_participant_kind,
        from_external_contact_id, from_external_name, from_external_phone, from_external_email,
        to_external_contact_id, to_external_name, to_external_phone, to_external_email,
        from_trip_id, to_trip_id, resource_id, meetup_label, meetup_latitude, meetup_longitude,
        window_starts_at, window_ends_at, opportunity_band, explanation, dependency_fingerprint,
        approved_at, updated_at
      ) values (
        'approved', ${from.legId}::uuid, ${to.legId}::uuid, ${from.kind}, ${to.kind},
        ${from.externalContactId}::uuid, ${from.externalName}, ${from.externalPhone}, ${from.externalEmail},
        ${to.externalContactId}::uuid, ${to.externalName}, ${to.externalPhone}, ${to.externalEmail},
        ${input.fromTripId}::uuid, ${input.toTripId}::uuid, ${input.resourceId}::uuid,
        ${input.meetupLabel}, ${input.meetupLatitude}, ${input.meetupLongitude},
        ${input.windowStartsAt}, ${input.windowEndsAt}, 'possible', 'Manual equipment meetup.',
        ${`manual:${randomUUID()}`}, now(), now()
      )
      returning id
    `);
    const id = rows<{ id: string }>(result)[0]?.id;
    if (!id) throw new Error("Manual equipment meetup could not be saved.");
    const saved = await this.selectOne(id);
    if (!saved) throw new Error("Manual equipment meetup could not be loaded.");
    return saved;
  }

  async updateParticipants(
    id: string,
    input: Pick<ManualHandoffInput, "fromParticipant" | "toParticipant">,
  ): Promise<EquipmentHandoff | null> {
    validateParticipants(input.fromParticipant, input.toParticipant);
    const from = participantValues(input.fromParticipant);
    const to = participantValues(input.toParticipant);
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      update equipment_handoffs set
        from_leg_id = ${from.legId}::uuid,
        to_leg_id = ${to.legId}::uuid,
        from_participant_kind = ${from.kind},
        to_participant_kind = ${to.kind},
        from_external_contact_id = ${from.externalContactId}::uuid,
        from_external_name = ${from.externalName},
        from_external_phone = ${from.externalPhone},
        from_external_email = ${from.externalEmail},
        to_external_contact_id = ${to.externalContactId}::uuid,
        to_external_name = ${to.externalName},
        to_external_phone = ${to.externalPhone},
        to_external_email = ${to.externalEmail},
        updated_at = now()
      where id = ${id}::uuid
      returning id
    `);
    const updatedId = rows<{ id: string }>(result)[0]?.id;
    return updatedId ? this.selectOne(updatedId) : null;
  }

  async upsertSuggestion(input: HandoffSuggestionInput): Promise<EquipmentHandoff> {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      insert into equipment_handoffs (
        status, from_leg_id, to_leg_id, from_participant_kind, to_participant_kind,
        from_trip_id, to_trip_id, resource_id,
        meetup_label, meetup_latitude, meetup_longitude, window_starts_at, window_ends_at,
        direct_miles, direct_minutes, from_detour_miles, from_detour_minutes,
        to_detour_miles, to_detour_minutes, combined_detour_miles, available_buffer_minutes,
        opportunity_band, explanation, dependency_fingerprint, updated_at
      ) values (
        'suggested', ${input.fromLegId}::uuid, ${input.toLegId}::uuid, 'leg', 'leg',
        ${input.fromTripId}::uuid, ${input.toTripId}::uuid, ${input.resourceId}::uuid,
        ${input.meetupLabel}, ${input.meetupLatitude}, ${input.meetupLongitude},
        ${input.windowStartsAt}, ${input.windowEndsAt}, ${input.directMiles}, ${input.directMinutes},
        ${input.fromDetourMiles}, ${input.fromDetourMinutes}, ${input.toDetourMiles}, ${input.toDetourMinutes},
        ${input.combinedDetourMiles}, ${input.availableBufferMinutes}, ${input.opportunityBand},
        ${input.explanation}, ${input.dependencyFingerprint}, now()
      )
      on conflict (dependency_fingerprint) do update set
        from_leg_id = excluded.from_leg_id,
        to_leg_id = excluded.to_leg_id,
        from_participant_kind = 'leg',
        to_participant_kind = 'leg',
        from_external_contact_id = null,
        from_external_name = null,
        from_external_phone = null,
        from_external_email = null,
        to_external_contact_id = null,
        to_external_name = null,
        to_external_phone = null,
        to_external_email = null,
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
