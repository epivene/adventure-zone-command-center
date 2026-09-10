import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/organizations/organization-repository", () => ({
  DrizzleOrganizationRepository: class {
    async listOrganizations(query: { search: string }) {
      if (query.search !== "Rock Springs") {
        throw new Error("full fuzzy candidate scan started");
      }
      return {
        records: [{ id: "profile-1", name: "Rock Springs Fair", city: "Rock Springs", region: "WY", primaryContactName: null, contactCount: 1, bookingCount: 0, locationCount: 1 }],
        total: 1,
        page: 1,
        pageSize: 12,
        pageCount: 1,
      };
    }
  },
}));
vi.mock("@/features/event-families/event-family-list", () => ({
  attachEventFamiliesToOrganizationPage: vi.fn(async (_db, _query, page) => ({
    organizations: page,
    families: [],
  })),
}));

import { OfficeProfileService } from "./office-profile-service";

describe("OfficeProfileService profile search", () => {
  it("returns ordinary matches without starting the expensive fuzzy candidate scan", async () => {
    const database = { execute: vi.fn(async () => ({ rows: [] })) };

    const result = await new OfficeProfileService(database as any).listProfiles({ search: "Rock Springs", page: 1 });

    expect(result.records.map((record) => record.name)).toEqual(["Rock Springs Fair"]);
  });
});
