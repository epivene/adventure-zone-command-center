import { describe, expect, it, vi } from "vitest";

import { GoogleProfileLabelCleanupService } from "./google-profile-label-cleanup-service";

describe("GoogleProfileLabelCleanupService", () => {
  it("previews only managed profile labels that do not match a current CRM profile", async () => {
    const service = new GoogleProfileLabelCleanupService(
      {
        listCurrentProfileNames: async () => [
          "Current Fair - Logan UT",
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
        listCurrentProfileNames: async () => currentNames,
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

    currentNames = ["Old Two"];

    await expect(
      service.deleteSelected(["old-1", "old-2", "outside-root"]),
    ).resolves.toEqual({
      deleted: [
        { id: "old-1", name: "Z - AdventureZone/Profiles/Old One" },
      ],
      skippedLabelIds: ["old-2", "outside-root"],
      failed: [],
    });
    expect(deleteLabel).toHaveBeenCalledTimes(1);
    expect(deleteLabel).toHaveBeenCalledWith("old-1");
  });

  it("fails closed when any current CRM profile name cannot be represented", async () => {
    const service = new GoogleProfileLabelCleanupService(
      {
        listCurrentProfileNames: async () => ["A".repeat(181)],
      },
      {
        listLabels: async () => [
          {
            id: "old",
            name: "Z - AdventureZone/Profiles/Old",
            type: "user",
          },
        ],
        deleteLabel: vi.fn(),
      },
    );

    await expect(service.preview()).rejects.toThrow(
      "GOOGLE_WORKSPACE_PROFILE_LABEL_NAME_INVALID",
    );
  });

  it("does not delete in Gmail when mapping invalidation fails", async () => {
    const deleteLabel = vi.fn(async () => undefined);
    const service = new GoogleProfileLabelCleanupService(
      {
        listCurrentProfileNames: async () => [],
        prepareLabelDeletion: async () => {
          throw new Error("DATABASE_UNAVAILABLE");
        },
      },
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

    await expect(service.deleteSelected(["old"])).resolves.toMatchObject({
      deleted: [],
      failed: [{ id: "old", errorCode: "DATABASE_UNAVAILABLE" }],
    });
    expect(deleteLabel).not.toHaveBeenCalled();
  });

  it("continues safely and reports per-label failures", async () => {
    const deleteLabel = vi.fn(async (labelId: string) => {
      if (labelId === "bad") throw new Error("GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED");
    });
    const service = new GoogleProfileLabelCleanupService(
      {
        listCurrentProfileNames: async () => [],
        prepareLabelDeletion: async () => undefined,
      },
      {
        listLabels: async () => [
          {
            id: "bad",
            name: "Z - AdventureZone/Profiles/Bad",
            type: "user",
          },
          {
            id: "good",
            name: "Z - AdventureZone/Profiles/Good",
            type: "user",
          },
        ],
        deleteLabel,
      },
    );

    await expect(service.deleteSelected(["bad", "good"])).resolves.toMatchObject({
      deleted: [
        { id: "good", name: "Z - AdventureZone/Profiles/Good" },
      ],
      failed: [
        {
          id: "bad",
          name: "Z - AdventureZone/Profiles/Bad",
          errorCode: "GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED",
        },
      ],
    });
  });

  it("deduplicates selected IDs before deleting", async () => {
    const deleteLabel = vi.fn(async () => undefined);
    const service = new GoogleProfileLabelCleanupService(
      { listCurrentProfileNames: async () => [] },
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
