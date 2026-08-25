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
});
