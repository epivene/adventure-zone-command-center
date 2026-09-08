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

describe("businessDocumentsApi document listing", () => {
  it("loads every page instead of stopping at the first 100 documents", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `document-${index}` }));
    auth.apiGet
      .mockResolvedValueOnce({ documents: firstPage })
      .mockResolvedValueOnce({ documents: [{ id: "document-100" }] });

    const result = await businessDocumentsApi.listAll();

    expect(auth.apiGet).toHaveBeenNthCalledWith(1, "/business-documents?limit=100&offset=0");
    expect(auth.apiGet).toHaveBeenNthCalledWith(2, "/business-documents?limit=100&offset=100");
    expect(result.documents).toHaveLength(101);
  });
});
