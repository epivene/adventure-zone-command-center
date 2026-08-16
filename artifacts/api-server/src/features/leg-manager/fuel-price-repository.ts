import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";

export type FuelPriceObservation = {
  id: string;
  legId: string;
  tripId: string | null;
  pricePerGallon: number;
  locationLabel: string;
  observedAt: Date;
  note: string | null;
  createdByManagerId: string | null;
  createdAt: Date;
};

export type CreateFuelPriceObservationInput = Omit<FuelPriceObservation, "id" | "createdAt">;

export interface FuelPriceStore {
  insert(input: CreateFuelPriceObservationInput): Promise<FuelPriceObservation>;
  listForLeg(legId: string, limit?: number): Promise<FuelPriceObservation[]>;
}

export async function recordFuelPriceObservation(
  store: FuelPriceStore,
  input: CreateFuelPriceObservationInput,
): Promise<FuelPriceObservation> {
  if (!Number.isFinite(input.pricePerGallon) || input.pricePerGallon <= 0) {
    throw new Error("Fuel price must be greater than zero.");
  }
  if (!input.locationLabel.trim()) {
    throw new Error("Fuel-price location is required.");
  }
  return store.insert({
    ...input,
    locationLabel: input.locationLabel.trim(),
    note: input.note?.trim() || null,
  });
}

export async function latestFuelPriceObservation(
  store: FuelPriceStore,
  legId: string,
): Promise<FuelPriceObservation | null> {
  return (await store.listForLeg(legId, 1))[0] ?? null;
}

type DrizzleDatabase = typeof database;

function rows<T>(value: unknown): T[] {
  return ((value as { rows?: T[] }).rows ?? []) as T[];
}

function normalize(row: any): FuelPriceObservation {
  return {
    ...row,
    pricePerGallon: Number(row.pricePerGallon),
    observedAt: row.observedAt instanceof Date ? row.observedAt : new Date(row.observedAt),
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
  };
}

const ensureSql = sql.raw(`
create table if not exists manager_fuel_price_observations (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references travel_legs(id) on delete restrict,
  trip_id uuid references trips(id) on delete set null,
  price_per_gallon numeric(8,3) not null check (price_per_gallon > 0),
  location_label text not null check (length(trim(location_label)) > 0),
  observed_at timestamptz not null,
  note text,
  created_by_manager_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists manager_fuel_price_leg_observed_idx
  on manager_fuel_price_observations(leg_id, observed_at desc, created_at desc);
`);

export class DrizzleFuelPriceRepository implements FuelPriceStore {
  constructor(private readonly database: DrizzleDatabase) {}

  async ensureSchema(): Promise<void> {
    await this.database.execute(ensureSql);
  }

  async insert(input: CreateFuelPriceObservationInput): Promise<FuelPriceObservation> {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      insert into manager_fuel_price_observations (
        leg_id, trip_id, price_per_gallon, location_label, observed_at, note, created_by_manager_id
      ) values (
        ${input.legId}::uuid,
        ${input.tripId}::uuid,
        ${input.pricePerGallon},
        ${input.locationLabel},
        ${input.observedAt},
        ${input.note},
        ${input.createdByManagerId}::uuid
      )
      returning
        id,
        leg_id as "legId",
        trip_id as "tripId",
        price_per_gallon as "pricePerGallon",
        location_label as "locationLabel",
        observed_at as "observedAt",
        note,
        created_by_manager_id as "createdByManagerId",
        created_at as "createdAt"
    `);
    const row = rows<any>(result)[0];
    if (!row) throw new Error("Fuel-price observation could not be saved.");
    return normalize(row);
  }

  async create(input: CreateFuelPriceObservationInput): Promise<FuelPriceObservation> {
    return recordFuelPriceObservation(this, input);
  }

  async listForLeg(legId: string, limit = 20): Promise<FuelPriceObservation[]> {
    await this.ensureSchema();
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const result = await this.database.execute(sql`
      select
        id,
        leg_id as "legId",
        trip_id as "tripId",
        price_per_gallon as "pricePerGallon",
        location_label as "locationLabel",
        observed_at as "observedAt",
        note,
        created_by_manager_id as "createdByManagerId",
        created_at as "createdAt"
      from manager_fuel_price_observations
      where leg_id = ${legId}::uuid
      order by observed_at desc, created_at desc
      limit ${safeLimit}
    `);
    return rows<any>(result).map(normalize);
  }

  async latestForLeg(legId: string): Promise<FuelPriceObservation | null> {
    return latestFuelPriceObservation(this, legId);
  }
}
