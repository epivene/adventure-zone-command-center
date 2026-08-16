import { describe, expect, it } from "vitest";
import {
  latestFuelPriceObservation,
  recordFuelPriceObservation,
  type CreateFuelPriceObservationInput,
  type FuelPriceObservation,
  type FuelPriceStore,
} from "./fuel-price-repository";

function memoryStore(): FuelPriceStore & { rows: FuelPriceObservation[] } {
  const rows: FuelPriceObservation[] = [];
  return {
    rows,
    async insert(input: CreateFuelPriceObservationInput) {
      const row: FuelPriceObservation = {
        id: `fuel-${rows.length + 1}`,
        ...input,
        createdAt: new Date(`2026-08-15T20:0${rows.length}:00Z`),
      };
      rows.push(row);
      return row;
    },
    async listForLeg(legId: string, limit = 20) {
      return rows
        .filter((row) => row.legId === legId)
        .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())
        .slice(0, limit);
    },
  };
}

const legA = "00000000-0000-4000-8000-000000000001";
const legB = "00000000-0000-4000-8000-000000000002";

function input(overrides: Partial<CreateFuelPriceObservationInput> = {}): CreateFuelPriceObservationInput {
  return {
    legId: legA,
    tripId: null,
    pricePerGallon: 3.49,
    locationLabel: "Dickinson, ND",
    observedAt: new Date("2026-08-15T18:00:00Z"),
    note: null,
    createdByManagerId: null,
    ...overrides,
  };
}

describe("fuel price observations", () => {
  it("keeps history instead of overwriting", async () => {
    const store = memoryStore();
    await recordFuelPriceObservation(store, input());
    await recordFuelPriceObservation(store, input({
      pricePerGallon: 3.39,
      locationLabel: "Bismarck, ND",
      observedAt: new Date("2026-08-15T20:00:00Z"),
      note: "Cheaper east side",
    }));

    const rows = await store.listForLeg(legA);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.pricePerGallon).toBe(3.39);
    expect(rows[1]?.pricePerGallon).toBe(3.49);
  });

  it("returns the newest observation for the requested leg only", async () => {
    const store = memoryStore();
    await recordFuelPriceObservation(store, input({ observedAt: new Date("2026-08-15T18:00:00Z") }));
    await recordFuelPriceObservation(store, input({ legId: legB, pricePerGallon: 4.25, observedAt: new Date("2026-08-15T22:00:00Z") }));
    await recordFuelPriceObservation(store, input({ pricePerGallon: 3.29, observedAt: new Date("2026-08-15T21:00:00Z") }));

    expect((await latestFuelPriceObservation(store, legA))?.pricePerGallon).toBe(3.29);
    expect((await latestFuelPriceObservation(store, legB))?.pricePerGallon).toBe(4.25);
  });

  it("rejects invalid price and blank location before writing", async () => {
    const store = memoryStore();
    await expect(recordFuelPriceObservation(store, input({ pricePerGallon: 0 }))).rejects.toThrow(/greater than zero/i);
    await expect(recordFuelPriceObservation(store, input({ locationLabel: "   " }))).rejects.toThrow(/location/i);
    expect(store.rows).toHaveLength(0);
  });
});
