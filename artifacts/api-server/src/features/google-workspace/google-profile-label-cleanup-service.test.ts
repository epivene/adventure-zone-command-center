import { describe, expect, it, vi } from "vitest";

import { GoogleProfileLabelCleanupService } from "./google-profile-label-cleanup-service";

describe("GoogleProfileLabelCleanupService", () => {
  it("previews only managed profile labels that do not match a current CRM profile", async () => {
    const service = new GoogleProfileLabelCleanupService(
      {
        listCanonicalLabelNames: async () => [
          "Z - AdventureZone/Profiles/Current Fair - Logan UT",
        ],
      },
      {
        listLabels: async () => [
          { id: "root", name: "Z - AdventureZone", type: "user" },
          { id: "profiles", name: "Z - AdventureZone/Profiles", type: "user" },
          {
            id: "current",
            name: "Z - AdventureZone/Profiles/Current Fair - Logan UT",
            type: "user",
          },
          {
            id: "old",
            name: "Z - AdventureZone/Profiles/Current Fair",
            type: "user",
          },
          { id: "other", name: "BANKING & LOANS/Affirm", type: "user" },
          {
            id: "system",
            name: "Z - AdventureZone/Profiles/System",
            type: "system",
          },
        ],
        deleteLabel: vi.fn(),
      },
    );

    await expect(service.preview()).resolves.toEqual({
      labels: [
        {
          id: "old",
          name: "Z - AdventureZone/Profiles/Current Fair",
        },
      ],
    });
  });

  it("deletes only selected labels that are still unmatched when confirmed", async () => {
    const deleteLabel = vi.fn(async () => undefined);
    let currentNames: string[] = [];
    const service = new GoogleProfileLabelCleanupService(
      {
        listCanonicalLabelNames: async () => currentNames,
      },
      {
        listLabels: async () => [
          {
            id: "old-1",
            name: "Z - AdventureZone/Profiles/Old One",
            type: "user",
          },
          {
            id: "old-2",
            name: "Z - AdventureZone/Profiles/Old Two",
            type: "user",
          },
        ],
        deleteLabel,
      },
    );

    await expect(service.preview()).resolves.toEqual({
      labels: [
        { id: "old-1", name: "Z - AdventureZone/Profiles/Old One" },
        { id: "old-2", name: "Z - AdventureZone/Profiles/Old Two" },
      ],
    });

    currentNames = ["Z - AdventureZone/Profiles/Old Two"];

    await expect(
      service.deleteSelected(["old-1", "old-2", "outside-root"]),
    ).resolves.toEqual({
      deleted: [
        { id: "old-1", name: "Z - AdventureZone/Profiles/Old One" },
      ],
      skippedLabelIds: ["old-2", "outside-root"],
    });
    expect(deleteLabel).toHaveBeenCalledTimes(1);
    expect(deleteLabel).toHaveBeenCalledWith("old-1");
  });

  it("deduplicates selected IDs before deleting", async () => {
    const deleteLabel = vi.fn(async () => undefined);
    const service = new GoogleProfileLabelCleanupService(
      { listCanonicalLabelNames: async () => [] },
      {
        listLabels: async () => [
          {
            id: "old",
            name: "Z - AdventureZone/Profiles/Old",
            type: "user",
          },
        ],
        deleteLabel,
      },
    );

    await service.deleteSelected(["old", "old"]);

    expect(deleteLabel).toHaveBeenCalledTimes(1);
  });
});
