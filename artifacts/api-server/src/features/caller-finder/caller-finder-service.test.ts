import { describe, expect, it, vi } from "vitest";

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
    matchedOrganizationOrEvent: false,
    matchedLocation: false,
    matchedRouteLeg: false,
    ...overrides,
  };
}

function serviceWith(
  candidates: CallerFinderCandidate[],
  exactMetadata = {
    exactPhoneContactIds: candidates
      .filter((candidate) => candidate.normalizedPhones.includes("+17015550199"))
      .map((candidate) => candidate.contactId),
    hasExactEmail: false,
  },
) {
  const repository: CallerFinderRepository = {
    findCallerCandidates: async () => candidates,
    findCallerExactMetadata: async () => exactMetadata,
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

  it.each(["5550199", "15550199", "701555019"])(
    "keeps the %s phone fragment as a click-only phone suggestion",
    async (fragment) => {
    const findCallerCandidates = vi.fn(async () => [
      candidate(exactContactId, {
        normalizedPhones: ["+17015550199"],
      }),
    ]);
    const repository: CallerFinderRepository = {
      findCallerCandidates,
      findCallerExactMetadata: async () => ({
        exactPhoneContactIds: [],
        hasExactEmail: false,
      }),
    };

    const result = await new CallerFinderService(repository).find({
      phone: fragment,
      query: "",
    });

    expect(result.exact).toEqual({ kind: "none" });
    expect(result.suggestions[0]).toMatchObject({
      contactId: exactContactId,
      reasons: ["Phone number"],
    });
    expect(findCallerCandidates).toHaveBeenCalledWith({
      normalizedPhone: null,
      phoneFragment: fragment,
      query: "",
      includeNotes: false,
    });
    },
  );

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

  it("does not auto-open when a second exact owner falls beyond the candidate query cap", async () => {
    const visibleExactId = "00000000-0000-4000-8000-000000000000";
    const hiddenExactId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const candidates = Array.from({ length: 64 }, (_, index) =>
      candidate(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, {
        normalizedPhones: index === 0 ? ["+17015550199"] : [],
        dueToday: index > 0,
      }),
    );
    const service = serviceWith(candidates, {
      exactPhoneContactIds: [visibleExactId, hiddenExactId],
      hasExactEmail: false,
    });

    const result = await service.find({ phone: "701-555-0199", query: "" });

    expect(result.exact).toEqual({ kind: "none" });
    expect(result.suggestions).toHaveLength(8);
  });

  it("does not allow create when an exact email falls beyond bounded candidates", async () => {
    const service = serviceWith(
      Array.from({ length: 64 }, (_, index) =>
        candidate(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, {
          dueToday: true,
        }),
      ),
      { exactPhoneContactIds: [], hasExactEmail: true },
    );

    const result = await service.find({ phone: "", query: "hidden@example.com" });

    expect(result.exact).toEqual({ kind: "none" });
    expect(result.canCreate).toBe(false);
  });

  it("scores an older matching booking and route leg even when latest display fields differ", async () => {
    const service = serviceWith([
      candidate(dueTodayContactId, {
        bookingName: "Newest Gala",
        routeLegName: "South",
        matchedOrganizationOrEvent: true,
        matchedRouteLeg: true,
      }),
    ]);

    const result = await service.find({ phone: "", query: "Harvest" });

    expect(result.suggestions[0]).toMatchObject({
      contactId: dueTodayContactId,
      reasons: ["Organization or event", "Route leg"],
      score: 850,
    });
  });

  it("scores a matching older booking location independently of contact location", async () => {
    const service = serviceWith([
      candidate(dueTodayContactId, {
        city: null,
        region: null,
        matchedLocation: true,
      }),
    ]);

    const result = await service.find({ phone: "", query: "Minot" });

    expect(result.suggestions[0]).toMatchObject({
      contactId: dueTodayContactId,
      reasons: ["Location"],
      score: 150,
    });
  });

  it("drops unrelated due-today candidates when a typed name has a genuine match", async () => {
    const genuineId = "33333333-3333-4333-8333-333333333333";
    const candidates = [
      ...Array.from({ length: 65 }, (_, index) => candidate(
        `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        { name: `Unrelated ${index}`, dueToday: true },
      )),
      candidate(genuineId, { name: "Genuine Match" }),
    ];

    const result = await serviceWith(candidates).find({ phone: "", query: "Genuine" });

    expect(result.suggestions).toEqual([
      expect.objectContaining({ contactId: genuineId, reasons: ["Name"] }),
    ]);
  });

  it.each([
    ["58103", { matchedLocation: true }, "Location"],
    ["pending contract", { bookingStatus: "pending_contract" }, "Organization or event"],
  ] as const)("finds advertised %s input", async (query, overrides, reason) => {
    const result = await serviceWith([
      candidate(dueTodayContactId, overrides),
    ]).find({ phone: "", query });

    expect(result.suggestions[0]).toMatchObject({ reasons: [reason] });
  });
});
