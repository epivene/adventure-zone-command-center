import { describe, expect, it, vi } from "vitest";

import { PaperNoteManualProfileSearchService } from "./paper-note-manual-profile-search";

describe("PaperNoteManualProfileSearchService", () => {
  it("returns bounded rich profile results without auto-selecting one", async () => {
    const repository = {
      searchProfiles: vi.fn(async () => [
        { organizationId: "10000000-0000-4000-8000-000000000001", name: "County Fair", city: "Fargo", region: "ND" },
      ]),
      findDetails: vi.fn(async () => new Map([
        ["10000000-0000-4000-8000-000000000001", {
          contacts: [{ id: "50000000-0000-4000-8000-000000000001", name: "Amy", role: null, email: null, phones: [] }],
          organizationPhones: [],
        }],
      ])),
    };

    const results = await new PaperNoteManualProfileSearchService(repository).search("county", 8);
    expect(repository.searchProfiles).toHaveBeenCalledWith("county", 8);
    expect(results).toEqual([expect.objectContaining({
      organizationId: "10000000-0000-4000-8000-000000000001",
      name: "County Fair",
      contacts: [expect.objectContaining({ name: "Amy" })],
      reasons: ["manual profile search"],
    })]);
  });

  it("does not query for blank searches", async () => {
    const repository = { searchProfiles: vi.fn(), findDetails: vi.fn() };
    await expect(new PaperNoteManualProfileSearchService(repository as any).search("   ")).resolves.toEqual([]);
    expect(repository.searchProfiles).not.toHaveBeenCalled();
  });
});
