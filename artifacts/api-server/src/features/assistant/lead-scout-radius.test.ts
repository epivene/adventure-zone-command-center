import { describe, expect, it, vi } from "vitest";

import { RadiusLeadScoutService, type RadiusScoutRequest } from "./lead-scout-radius";

const request: RadiusScoutRequest = {
  anchor: { kind: "manual", label: "Miles City, MT" },
  radiusMiles: 200,
  dateStart: "2026-08-24",
  dateEnd: "2026-09-12",
  categories: ["fair", "festival"],
  historyFilter: "hide_booked",
};

function harness(options: { areaFails?: boolean; geocodeFails?: boolean } = {}) {
  let savedCriteria: any = null;
  let savedSummary = "";
  const repository = {
    createRun: vi.fn(async (input: any) => {
      savedCriteria = input.criteria;
      savedSummary = input.criteriaSummary;
      return "30000000-0000-4000-8000-000000000001";
    }),
    setCriteria: vi.fn(async (_runId: string, input: any) => {
      savedCriteria = input.criteria;
      savedSummary = input.criteriaSummary;
    }),
    setCrmReady: vi.fn(async () => undefined),
    setFailed: vi.fn(async () => undefined),
    getRun: vi.fn(async () => ({
      id: "30000000-0000-4000-8000-000000000001",
      originalQuestion: savedCriteria.originalQuestion,
      criteria: savedCriteria,
      criteriaSummary: savedSummary,
      status: "crm_ready",
      stage: "crm_search",
      progress: { label: "Waiting for web-search approval", sourcesChecked: 0, candidatesFound: 0, candidatesEnriched: 0, candidatesCompared: 0 },
      crmMatches: [], candidates: [], sources: [],
      startedAt: "2026-08-25T12:00:00.000Z", completedAt: null,
      createdAt: "2026-08-25T12:00:00.000Z", updatedAt: "2026-08-25T12:00:00.000Z", failureMessage: null,
    })),
  };
  const crmSearch = { search: vi.fn(async () => []) };
  const geocoder = {
    resolve: vi.fn(async () => options.geocodeFails ? null : ({
      latitude: 46.4083,
      longitude: -105.8406,
      displayName: "Miles City, Montana",
    })),
  };
  const areaResolver = {
    listPlaces: vi.fn(async () => {
      if (options.areaFails) throw new Error("overpass down");
      return [
        { name: "Miles City", placeType: "city", latitude: 46.4083, longitude: -105.8406, distanceMiles: 0 },
        { name: "Billings", placeType: "city", latitude: 45.7833, longitude: -108.5007, distanceMiles: 145.2 },
      ];
    }),
  };
  const service = new RadiusLeadScoutService(repository as any, crmSearch as any, geocoder as any, areaResolver as any);
  return { service, repository, crmSearch, geocoder, areaResolver };
}

describe("RadiusLeadScoutService", () => {
  it("expands the search across named communities inside the selected radius", async () => {
    const { service, repository, crmSearch } = harness();

    const run = await service.create({ actorId: "owner-1", request });

    expect(run.criteria?.geoMode).toBe("radius");
    expect(run.criteria?.cities).toEqual(["Miles City", "Billings"]);
    expect((run.criteria as any).radiusScope).toMatchObject({
      radiusMiles: 200,
      searchAreaIncomplete: false,
      anchor: { latitude: 46.4083, longitude: -105.8406 },
    });
    expect((run.criteria as any).radiusScope.searchPlaces).toHaveLength(2);
    expect(crmSearch.search).toHaveBeenCalledWith(expect.objectContaining({ cities: ["Miles City", "Billings"] }), 10);
    expect(repository.setCrmReady).toHaveBeenCalledTimes(1);
  });

  it("falls back to the anchor city when community enumeration is temporarily unavailable", async () => {
    const { service } = harness({ areaFails: true });

    const run = await service.create({ actorId: "owner-1", request });

    expect(run.criteria?.cities).toEqual(["Miles City"]);
    expect((run.criteria as any).radiusScope.searchAreaIncomplete).toBe(true);
    expect(run.criteriaSummary).toMatch(/area lookup incomplete/i);
  });

  it("rejects an anchor that cannot be geocoded before creating a run", async () => {
    const { service, repository } = harness({ geocodeFails: true });

    await expect(service.create({ actorId: "owner-1", request })).rejects.toThrow("SCOUT_ANCHOR_NOT_RESOLVED");
    expect(repository.createRun).not.toHaveBeenCalled();
  });
});