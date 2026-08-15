import { describe, expect, it } from "vitest";
import { rankCrewWorkers } from "./crew-search";
import type { CrewWorkerWithHistory } from "./crew-types";

const workers: CrewWorkerWithHistory[] = [
  {
    id: "exact",
    name: "Alex Exact",
    phone: "7015551000",
    normalizedPhone: "7015551000",
    email: null,
    city: "Fargo",
    region: "ND",
    locationText: "Fargo, ND",
    rehireStatus: "rehirable",
    workHistory: [{
      id: "h1", workerId: "exact", legId: "leg-a", bookingId: null, tripId: null,
      role: "Setup", startedAt: new Date("2026-06-01T12:00:00Z"), endedAt: null,
      rating: 5, note: "Excellent",
    }],
    managerNotes: [],
  },
  {
    id: "region",
    name: "Riley Region",
    phone: "7015552000",
    normalizedPhone: "7015552000",
    email: null,
    city: "Bismarck",
    region: "ND",
    locationText: "Bismarck, ND",
    rehireStatus: "do_not_rehire",
    workHistory: [],
    managerNotes: [],
  },
  {
    id: "text",
    name: "Fargo Helper",
    phone: "6055553000",
    normalizedPhone: "6055553000",
    email: "helper@example.com",
    city: "Aberdeen",
    region: "SD",
    locationText: "Aberdeen, SD",
    rehireStatus: "undecided",
    workHistory: [],
    managerNotes: [],
  },
];

describe("rankCrewWorkers", () => {
  it("ranks exact city+region before same region before text matches", () => {
    const result = rankCrewWorkers(workers, { city: "Fargo", region: "ND", query: "Fargo" });
    expect(result.map((worker) => worker.id)).toEqual(["exact", "region", "text"]);
  });

  it("keeps do-not-rehire workers visible with their warning status", () => {
    const result = rankCrewWorkers(workers, { region: "ND" });
    expect(result).toContainEqual(
      expect.objectContaining({ id: "region", rehireStatus: "do_not_rehire" }),
    );
  });

  it("preserves prior work history for staffing context", () => {
    const result = rankCrewWorkers(workers, { city: "Fargo", region: "ND" });
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: "exact",
        workHistory: expect.arrayContaining([expect.objectContaining({ rating: 5 })]),
      }),
    );
  });
});
