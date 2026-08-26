import { describe, expect, it, vi } from "vitest";
import { createLeadIntakeClient } from "./lead-intake-client";

describe("lead intake profile search", () => {
  it("returns profile records from the paginated organizations response", async () => {
    const profile = {
      id: "org-1",
      name: "Alamosa ARTs Festival (Alamosa) CO",
      city: "Alamosa",
      region: "CO",
    };
    const api = {
      get: vi.fn().mockResolvedValue({
        organizations: {
          records: [profile],
          total: 1,
          page: 1,
          pageSize: 10,
          pageCount: 1,
        },
        families: [],
        travelLegs: [],
      }),
      post: vi.fn(),
    };

    const results = await createLeadIntakeClient(api).searchProfiles("Alamosa ARTs Festival");

    expect(results).toEqual([profile]);
    expect(api.get).toHaveBeenCalledWith("/organizations?q=Alamosa%20ARTs%20Festival&pageSize=10");
  });

  it("posts the current review version when classifying previous contact", async () => {
    const classification = {
      rowId: "row-1",
      reviewVersion: 3,
      outcome: "returning_contact" as const,
      cutoffDate: "2023-08-25",
      evidenceIds: ["gmail:message-1"],
      latestOutboundAt: null,
      latestVerifiedResponseAt: "2025-05-14T12:00:00.000Z",
      reviewRequired: false,
    };
    const api = { get: vi.fn(), post: vi.fn().mockResolvedValue(classification) };

    await expect(createLeadIntakeClient(api).classifyRelationship("row-1", 2))
      .resolves.toEqual(classification);
    expect(api.post).toHaveBeenCalledWith(
      "/lead-intake/rows/row-1/classify-relationship",
      { expectedVersion: 2 },
    );
  });
});
