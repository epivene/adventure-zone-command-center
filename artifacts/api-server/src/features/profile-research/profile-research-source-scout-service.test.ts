import { describe, expect, it, vi } from "vitest";

import { ProfileResearchSourceScoutService } from "./profile-research-source-scout-service";

describe("ProfileResearchSourceScoutService", () => {
  it("persists a CRM-classified source scout on a complete research run", async () => {
    let summary: any = { identity: { confidence: "high" } };
    const runs = {
      getRun: vi.fn().mockResolvedValue({ id: "run-1", profileId: "profile-1", status: "complete", summary }),
      updateSummary: vi.fn(async (_profileId: string, _runId: string, next: unknown) => { summary = next; return true; }),
    };
    const provider = {
      scout: vi.fn().mockResolvedValue({
        sourceUrl: "https://gobreck.com/events",
        sourceTitle: "GoBreck events",
        startDate: "2026-06-01",
        endDate: "2026-10-31",
        scoutedAt: "2026-08-19T12:00:00.000Z",
        events: [{ name: "Festival A", city: "Breckenridge", region: "CO", startsAt: "2026-08-20", endsAt: null, venue: null, url: "https://gobreck.com/events/a", rationale: "Official event listing" }],
      }),
    };
    const matcher = vi.fn().mockResolvedValue([{ name: "Festival A", city: "Breckenridge", region: "CO", startsAt: "2026-08-20", endsAt: null, venue: null, url: "https://gobreck.com/events/a", rationale: "Official event listing", crmMatch: { status: "new_prospect" } }]);
    const service = new ProfileResearchSourceScoutService(runs as any, provider as any, matcher as any);

    const run = await service.scout({ profileId: "profile-1", runId: "run-1", sourceUrl: "https://gobreck.com/events", sourceTitle: "GoBreck events", startDate: "2026-06-01", endDate: "2026-10-31" });

    expect(run.summary.sourceScouts).toHaveLength(1);
    expect(run.summary.sourceScouts[0].events[0].crmMatch.status).toBe("new_prospect");
    expect(runs.updateSummary).toHaveBeenCalledTimes(1);
  });

  it("replaces the same source/date-window scout instead of duplicating it", async () => {
    let summary: any = { sourceScouts: [{ sourceUrl: "https://gobreck.com/events", startDate: "2026-06-01", endDate: "2026-10-31", events: [] }] };
    const runs = {
      getRun: vi.fn(async () => ({ id: "run-1", profileId: "profile-1", status: "complete", summary })),
      updateSummary: vi.fn(async (_profileId: string, _runId: string, next: unknown) => { summary = next; return true; }),
    };
    const provider = { scout: vi.fn().mockResolvedValue({ sourceUrl: "https://gobreck.com/events", sourceTitle: null, startDate: "2026-06-01", endDate: "2026-10-31", scoutedAt: "2026-08-19T13:00:00.000Z", events: [] }) };
    const service = new ProfileResearchSourceScoutService(runs as any, provider as any, vi.fn().mockResolvedValue([]) as any);
    const run = await service.scout({ profileId: "profile-1", runId: "run-1", sourceUrl: "https://gobreck.com/events", startDate: "2026-06-01", endDate: "2026-10-31" });
    expect(run.summary.sourceScouts).toHaveLength(1);
  });

  it("rejects a missing or incomplete parent research run", async () => {
    const service = new ProfileResearchSourceScoutService({ getRun: vi.fn().mockResolvedValue(null) } as any, { scout: vi.fn() } as any, vi.fn() as any);
    await expect(service.scout({ profileId: "profile-1", runId: "run-1", sourceUrl: "https://gobreck.com/events", startDate: "2026-06-01", endDate: "2026-10-31" })).rejects.toThrow("PROFILE_RESEARCH_RUN_NOT_FOUND");
  });
});
