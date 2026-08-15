import { describe, expect, it } from "vitest";
import { createFinanceMutation, type FinanceMutationStore } from "./finance-repository";

function fakeStore(): FinanceMutationStore & { rows: any[] } {
  const rows: any[] = [];
  return {
    rows,
    async findByMutation(legId, kind, clientMutationId) {
      return rows.find(
        (row) =>
          row.legId === legId &&
          row.kind === kind &&
          row.clientMutationId === clientMutationId,
      ) ?? null;
    },
    async refsBelongToLeg(_legId, refs) {
      return (
        refs.tripId !== "trip-b" &&
        refs.bookingId !== "booking-b" &&
        refs.tripSegmentId !== "segment-b"
      );
    },
    async insert(kind, input) {
      const row = { id: `row-${rows.length + 1}`, kind, ...input };
      rows.push(row);
      return row;
    },
  };
}

describe("createFinanceMutation", () => {
  it("deduplicates the same expense mutation id", async () => {
    const store = fakeStore();
    const input = {
      legId: "leg-a",
      clientMutationId: "00000000-0000-4000-8000-000000000001",
      tripId: "trip-a",
      bookingId: null,
      tripSegmentId: null,
      payload: { amountCents: 5000 },
    };

    const first = await createFinanceMutation(store, "expense", input);
    const second = await createFinanceMutation(store, "expense", input);

    expect(first.ok && first.idempotent).toBe(false);
    expect(second.ok && second.idempotent).toBe(true);
    expect(store.rows).toHaveLength(1);
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
