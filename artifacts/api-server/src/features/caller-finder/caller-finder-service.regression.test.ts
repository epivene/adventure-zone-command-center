import { describe, expect, it, vi } from "vitest";

import {
  CallerFinderService,
  type CallerFinderRepository,
} from "./caller-finder-service";
import type { CallerFinderCandidate } from "./caller-finder-types";

function candidate(
  contactId: string,
  lastContactedAt: Date | null,
): CallerFinderCandidate {
  return {
    contactId,
    name: "Patrick Sieng",
    email: null,
    normalizedPhones: [],
    organizationName: null,
    city: null,
    region: null,
    bookingName: null,
    bookingStatus: null,
    routeLegName: null,
    lastContactedAt,
    dueToday: false,
    noteText: null,
    matchedOrganizationOrEvent: false,
    matchedLocation: false,
    matchedContactPostalCode: false,
    matchedRouteLeg: false,
  };
}

describe("caller finder production regressions", () => {
  it("sorts database timestamp strings without crashing", async () => {
    const repository: CallerFinderRepository = {
      findCallerCandidates: async () => [
        candidate(
          "11111111-1111-4111-8111-111111111111",
          "2026-09-14T12:00:00.000Z" as unknown as Date,
        ),
        candidate(
          "22222222-2222-4222-8222-222222222222",
          "2026-09-15T12:00:00.000Z" as unknown as Date,
        ),
      ],
      findCallerExactMetadata: async () => ({
        exactPhoneContactIds: [],
        hasExactEmail: false,
      }),
    };

    const result = await new CallerFinderService(repository).find({
      phone: "",
      query: "Patrick",
    });

    expect(result.suggestions.map(({ contactId }) => contactId)).toEqual([
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("does not run exact-email lookup metadata for a person's name", async () => {
    const findCallerExactMetadata = vi.fn(async () => ({
      exactPhoneContactIds: [],
      hasExactEmail: false,
    }));
    const repository: CallerFinderRepository = {
      findCallerCandidates: async () => [],
      findCallerExactMetadata,
    };

    await new CallerFinderService(repository).find({
      phone: "",
      query: "Patrick Sieng",
    });

    expect(findCallerExactMetadata).toHaveBeenCalledWith({
      normalizedPhone: null,
      normalizedEmail: null,
    });
  });
});
