import { describe, expect, it } from "vitest";

import { createAdminQuestionRecord } from "./admin-question-repository";

class MemoryStore {
  rows = new Map<string, any>();
  async findByClientMutationId(id: string) { return this.rows.get(id) ?? null; }
  async insert(input: any) {
    const row = { id: `q-${this.rows.size + 1}`, ...input, status: "needs_answer" };
    this.rows.set(input.clientMutationId, row);
    return row;
  }
}

describe("admin question repository", () => {
  it("returns the existing question when an offline retry repeats clientMutationId", async () => {
    const store = new MemoryStore();
    const input = {
      clientMutationId: "11111111-1111-4111-8111-111111111111",
      travelLegId: "22222222-2222-4222-8222-222222222222",
      bookingId: null,
      tripId: null,
      managerSessionSubject: "manager:leg-a",
      question: "Do we need a forklift?",
      urgency: "normal" as const,
      escalationReason: "No forklift note found.",
      checkedSourceRefs: [],
      contextSnapshot: { leg: "Leg A" },
    };
    const first = await createAdminQuestionRecord(store, input);
    const second = await createAdminQuestionRecord(store, input);
    expect(first.id).toBe(second.id);
    expect(second.idempotent).toBe(true);
    expect(store.rows.size).toBe(1);
  });
});
