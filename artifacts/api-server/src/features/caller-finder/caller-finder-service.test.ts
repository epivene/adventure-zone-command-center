import { describe, expect, it } from "vitest";

import {
  CallerFinderService,
  type CallerFinderRepository,
} from "./caller-finder-service";
import type { CallerFinderCandidate } from "./caller-finder-types";

const exactContactId = "11111111-1111-4111-8111-111111111111";
const dueTodayContactId = "22222222-2222-4222-8222-222222222222";

function candidate(
  contactId: string,
  overrides: Partial<CallerFinderCandidate> = {},
): CallerFinderCandidate {
  return {
    contactId,
    name: "Avery Lee",
    email: null,
    normalizedPhones: [],
    organizationName: null,
    city: null,
    region: null,
    bookingName: null,
    bookingStatus: null,
    routeLegName: null,
    lastContactedAt: null,
    dueToday: false,
    noteText: null,
    ...overrides,
  };
}

function serviceWith(candidates: CallerFinderCandidate[]) {
  const repository: CallerFinderRepository = {
    findCallerCandidates: async () => candidates,
  };
  return new CallerFinderService(repository);
}

describe("caller finder safety and ranking", () => {
  it("auto-opens only one exact normalized phone match", async () => {
    const service = serviceWith([
      candidate(exactContactId, {
        normalizedPhones: ["+17015550199", "+17015550100"],
      }),
      candidate(dueTodayContactId),
    ]);

    const result = await service.find({ phone: "(701) 555-0199", query: "" });

    expect(result.exact).toEqual({ kind: "one", contactId: exactContactId });
  });

  it("does not auto-open when more than one contact has the exact normalized phone", async () => {
    const service = serviceWith([
      candidate(exactContactId, { normalizedPhones: ["+17015550199"] }),
      candidate(dueTodayContactId, { normalizedPhones: ["+17015550199"] }),
    ]);

    const result = await service.find({ phone: "701-555-0199", query: "" });

    expect(result.exact).toEqual({ kind: "none" });
    expect(result.suggestions).toHaveLength(2);
  });

  it("keeps area-code matches as clickable suggestions", async () => {
    const service = serviceWith([
      candidate(dueTodayContactId, {
        name: "Due Today",
        normalizedPhones: ["+17015550100"],
        dueToday: true,
      }),
    ]);

    const result = await service.find({ phone: "701-555-9999", query: "" });

    expect(result.exact).toEqual({ kind: "none" });
    expect(result.suggestions[0]).toMatchObject({
      contactId: dueTodayContactId,
      reasons: ["Due today", "Same area code"],
      score: 350,
    });
  });

  it("does not search note bodies for two-character input", async () => {
    const service = serviceWith([
      candidate(dueTodayContactId, { noteText: "AZ planning details" }),
    ]);

    expect((await service.find({ phone: "", query: "az" })).suggestions)
      .not.toContainEqual(expect.objectContaining({
        reasons: expect.arrayContaining(["Note text"]),
      }));
  });

  it("caps note snippets and suggestions while applying deterministic tie breaks", async () => {
    const longNote = "festival ".repeat(30);
    const service = serviceWith(
      Array.from({ length: 10 }, (_, index) =>
        candidate(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, {
          name: `Festival Contact ${index}`,
          noteText: longNote,
          lastContactedAt: index < 2
            ? new Date(`2026-08-1${index}T12:00:00.000Z`)
            : null,
        }),
      ),
    );

    const result = await service.find({ phone: "", query: "festival" });

    expect(result.suggestions).toHaveLength(8);
    expect(result.suggestions[0]?.lastContactedAt).toEqual(
      new Date("2026-08-11T12:00:00.000Z"),
    );
    expect(result.suggestions[0]?.noteSnippet?.length).toBeLessThanOrEqual(160);
  });
});
