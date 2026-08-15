import { describe, expect, it } from "vitest";
import { crewManagerNotes, crewWorkHistory } from "@/db/schema";
import { DrizzleCrewRepository } from "./crew-repository";

function fakeInsertDatabase(returnRow: Record<string, unknown>) {
  const captured: { values?: Record<string, unknown>; target?: unknown } = {};
  const database = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        captured.values = values;
        return {
          onConflictDoNothing: ({ target }: { target: unknown }) => {
            captured.target = target;
            return { returning: async () => [returnRow] };
          },
        };
      },
    }),
  };
  return { database, captured };
}

describe("crew write idempotency", () => {
  it("uses the client mutation UUID as the work-history row id", async () => {
    const mutationId = "11111111-1111-4111-8111-111111111111";
    const { database, captured } = fakeInsertDatabase({ id: mutationId });
    const repository = new DrizzleCrewRepository(database as never);

    await repository.createWorkHistory({
      workerId: "22222222-2222-4222-8222-222222222222",
      legId: "33333333-3333-4333-8333-333333333333",
      role: "Crew",
      startedAt: new Date("2026-08-15T12:00:00Z"),
      clientMutationId: mutationId,
    });

    expect(captured.values?.id).toBe(mutationId);
    expect(captured.values).not.toHaveProperty("clientMutationId");
    expect(captured.target).toBe(crewWorkHistory.id);
  });

  it("uses the client mutation UUID as the manager-note row id", async () => {
    const mutationId = "44444444-4444-4444-8444-444444444444";
    const { database, captured } = fakeInsertDatabase({ id: mutationId });
    const repository = new DrizzleCrewRepository(database as never);

    await repository.createManagerNote({
      workerId: "55555555-5555-4555-8555-555555555555",
      legId: "66666666-6666-4666-8666-666666666666",
      note: "Good worker",
      clientMutationId: mutationId,
    });

    expect(captured.values?.id).toBe(mutationId);
    expect(captured.values).not.toHaveProperty("clientMutationId");
    expect(captured.target).toBe(crewManagerNotes.id);
  });
});
