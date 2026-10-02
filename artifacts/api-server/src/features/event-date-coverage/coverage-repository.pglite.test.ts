import { describe, expect, it, vi } from "vitest";

import {
  CoverageRepository,
  type CoverageDataSource,
} from "./coverage-repository";

const today = "2026-09-21";

function sourceFor(count: number): CoverageDataSource {
  return {
    loadOrganizations: vi.fn(async () => Array.from({ length: count }, (_, index) => ({
      id: `org-${index}`,
      name: `Event ${String(index).padStart(3, "0")}`,
      city: index === 0 ? "Portland" : null,
      region: index === 0 ? "OR" : null,
    }))),
    loadBookings: vi.fn(async () => [
      { id: "future-booking", organizationId: "org-0", startsOn: "2027-06-10", endsOn: "2027-06-11", status: "confirmed" },
      { id: "past-booking", organizationId: "org-3", startsOn: "2025-06-10", endsOn: "2025-06-11", status: "confirmed" },
    ]),
    loadFacts: vi.fn(async (): ReturnType<CoverageDataSource["loadFacts"]> => [
      { id: "confirmed", organizationId: "org-1", startsOn: "2027-07-01", endsOn: null, status: "confirmed", active: true, researchedAt: new Date("2026-09-01T00:00:00Z"), verifiedAt: null },
      { id: "review", organizationId: "org-2", startsOn: "2027-08-01", endsOn: null, status: "needs_review", active: false, researchedAt: new Date("2026-09-02T00:00:00Z"), verifiedAt: null },
    ]),
  };
}

describe("CoverageRepository", () => {
  it("derives summary counts and filtered rows from the same classification", async () => {
    const repository = new CoverageRepository(sourceFor(5));

    const all = await repository.list({ today, page: 1, pageSize: 100, search: "", status: "all" });
    expect(all.summary).toEqual({ booked: 1, confirmed: 1, expected: 0, missing: 1, stale: 1, needs_review: 1 });
    expect(all.records.map((row) => row.status)).toEqual([
      "booked", "confirmed", "needs_review", "stale", "missing",
    ]);

    const review = await repository.list({ today, page: 1, pageSize: 20, search: "", status: "needs_review" });
    expect(review.total).toBe(1);
    expect(review.records[0]?.organizationId).toBe("org-2");
    expect(review.summary).toEqual(all.summary);
  });

  it("supports text search and stable pagination", async () => {
    const repository = new CoverageRepository(sourceFor(12));
    const page = await repository.list({ today, page: 2, pageSize: 5, search: "event", status: "missing" });

    expect(page.page).toBe(2);
    expect(page.pageCount).toBe(2);
    expect(page.records.map((row) => row.organizationId)).toEqual([
      "org-9", "org-10", "org-11",
    ]);
  });

  it("loads a 100-row page with three bulk reads and no per-profile lookup", async () => {
    const source = sourceFor(100);
    const repository = new CoverageRepository(source);

    const page = await repository.list({ today, page: 1, pageSize: 100, search: "", status: "all" });

    expect(page.records).toHaveLength(100);
    expect(source.loadOrganizations).toHaveBeenCalledTimes(1);
    expect(source.loadBookings).toHaveBeenCalledTimes(1);
    expect(source.loadFacts).toHaveBeenCalledTimes(1);
  });
});
