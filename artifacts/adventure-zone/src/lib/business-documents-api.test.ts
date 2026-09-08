import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => auth);

import { businessDocumentsApi } from "./business-documents-api";

beforeEach(() => {
  auth.apiGet.mockReset().mockResolvedValue({ organizations: { records: [] } });
});

describe("businessDocumentsApi profile search", () => {
  it("includes event-family member profiles in review search results", async () => {
    await businessDocumentsApi.searchProfiles("North Ogden");

    expect(auth.apiGet).toHaveBeenCalledWith(
      "/organizations?q=North%20Ogden&pageSize=10&showMembers=yes&includeRetired=no",
    );
  });
});
