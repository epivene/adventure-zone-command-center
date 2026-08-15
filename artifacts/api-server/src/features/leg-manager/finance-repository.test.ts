import { describe, expect, it } from "vitest";
import {
  createFinanceMutation,
  derivedCashEntryForMutation,
  type FinanceMutationStore,
} from "./finance-repository";

function fakeStore(): FinanceMutationStore & { rows: any[]; derived: any[] } {
  const rows: any[] = [];
  const derived: any[] = [];
  return {
    rows,
    derived,
    async findByMutation(legId, kind, clientMutationId) {
      return rows.find(
        (row) => row.legId === legId && row.kind === kind && row.clientMutationId === clientMutationId,
      ) ?? null;
    },
    async refsBelongToLeg(_legId, refs) {
      return refs.tripId !== "trip-b" && refs.bookingId !== "booking-b" && refs.tripSegmentId !== "segment-b";
    },
    async insert(kind, input) {
      const row = { id: `row-${rows.length + 1}`, kind, ...input, ...input.payload };
      rows.push(row);
      return row;
    },
    async ensureDerivedCash(kind, input, row) {
      derived.push({ kind, input, row });
    },
  };
}

describe("createFinanceMutation", () => {
  it("deduplicates the same expense mutation id and still repairs derived cash", async () => {
    const store = fakeStore();
    const input = {
      legId: "leg-a",
      clientMutationId: "00000000-0000-4000-8000-000000000001",
      tripId: "trip-a",
      bookingId: null,
      tripSegmentId: null,
      payload: { amountCents: 5000, taxCents: 0, paymentSource: "adventure_zone_cash" },
    };
    const first = await createFinanceMutation(store, "expense", input);
    const second = await createFinanceMutation(store, "expense", input);
    expect(first.ok && first.idempotent).toBe(false);
    expect(second.ok && second.idempotent).toBe(true);
    expect(store.rows).toHaveLength(1);
    expect(store.derived).toHaveLength(2);
  });

  it("rejects references owned by a different leg", async () => {
    const store = fakeStore();
    const result = await createFinanceMutation(store, "expense", {
      legId: "leg-a",
      clientMutationId: "00000000-0000-4000-8000-000000000002",
      tripId: "trip-b",
      bookingId: null,
      tripSegmentId: null,
      payload: { amountCents: 5000 },
    });
    expect(result).toEqual({ ok: false, error: "OUTSIDE_LEG" });
    expect(store.rows).toHaveLength(0);
  });
});

describe("derivedCashEntryForMutation", () => {
  it("turns cash income into event cash collected", () => {
    expect(
      derivedCashEntryForMutation("income", { cashCents: 12500 }),
    ).toEqual({ kind: "event_cash_collected", amountCents: 12500 });
  });

  it("turns company-cash expenses into expense paid cash including tax", () => {
    expect(
      derivedCashEntryForMutation("expense", {
        paymentSource: "adventure_zone_cash",
        amountCents: 4000,
        taxCents: 250,
      }),
    ).toEqual({ kind: "expense_paid_cash", amountCents: 4250 });
  });
});
