import { describe, expect, it, vi } from "vitest";

import { ProfileResearchRepository } from "./profile-research-repository";

describe("ProfileResearchRepository coverage lease fence", () => {
  it("rolls back before persisting research results when the coverage lease is stale", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (statement: string) => {
        queries.push(statement);
        if (statement.includes("from event_date_coverage_items")) return { rows: [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    const repository = new ProfileResearchRepository(pool as never);

    await expect(repository.completeRun({
      runId: "run-1",
      profileId: "profile-1",
      sources: [{
        id: "source-1", kind: "web", title: "Official site", url: "https://example.test",
        publisher: "Example", retrievedAt: "2026-09-22T00:00:00.000Z", excerpt: "Dates",
      }],
      suggestions: [],
      coverageLease: { itemId: "item-1", workerId: "worker-a" },
    })).rejects.toThrow("COVERAGE_LEASE_LOST");

    expect(queries).toContain("begin");
    expect(queries).toContain("rollback");
    expect(queries.some((statement) => statement.includes("insert into profile_research_sources"))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
