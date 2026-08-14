import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActReplacementApiError,
  getArchivedProfileImport,
  resolveAutomaticReview,
  startArchivedProfileImport,
} from "./act-replacement-client";

const apiFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-token", () => ({ apiFetch }));

describe("resolveAutomaticReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts the exact manifest generation and request key to automatic review", async () => {
    const response = {
      summary: {
        linkedExisting: 2,
        importedNew: 1,
        relationshipsAssigned: 3,
        relationshipsOmitted: 1,
        actValuesSelected: 4,
        unsupportedIgnored: 1,
        manualReview: 2,
        decisionsCreatedOrReplayed: 12,
      },
      remainingReview: {
        count: 2,
        reasons: { field_conflict: 1, relationship_unresolved: 1 },
      },
      manifestDigest: "b".repeat(64),
      workflow: {
        safeOperationCount: 8,
        autoResolvedCount: 10,
        archivedOnlyCount: 1,
        reviewRequiredCount: 2,
        appliedOperationCount: 0,
        alreadyPresentOperationCount: 0,
        blockedOperationCount: 0,
        failedOperationCount: 0,
        nextApplyCursor: 0,
        canOrganize: false,
        canReview: true,
        canApplySafe: true,
      },
    };
    apiFetch.mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      resolveAutomaticReview("run / one", {
        expectedManifestDigest: "a".repeat(64),
        requestKey: "automatic-review-click-one",
      }),
    ).resolves.toEqual(response);
    expect(apiFetch).toHaveBeenCalledWith(
      "/migration/act-replacement/runs/run%20%2F%20one/automatic-review",
      {
        method: "POST",
        body: JSON.stringify({
          expectedManifestDigest: "a".repeat(64),
          requestKey: "automatic-review-click-one",
        }),
      },
    );
  });

  it("maps bounded server failures through the shared ACT API error", async () => {
    apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ code: "review_generation_changed" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      resolveAutomaticReview("run-one", {
        expectedManifestDigest: "a".repeat(64),
        requestKey: "automatic-review-click-one",
      }),
    ).rejects.toEqual(
      new ActReplacementApiError("review_generation_changed", 409),
    );
  });
});

describe("archived profile import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts one stable request key to an encoded run endpoint", async () => {
    const status = {
      jobId: "job-one",
      runId: "run / one",
      phase: "companies",
      active: true,
      eligibleCount: 120,
      processedCount: 50,
      createdCount: 31,
      linkedCount: 7,
      updatedCount: 3,
      alreadyImportedCount: 4,
      preservedCount: 3,
      retryableFailureCount: 2,
      lastErrorCode: null,
    };
    apiFetch.mockResolvedValue(
      new Response(JSON.stringify(status), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      startArchivedProfileImport("run / one", "profile-import-click-one"),
    ).resolves.toEqual(status);
    expect(apiFetch).toHaveBeenCalledWith(
      "/migration/act-replacement/runs/run%20%2F%20one/import-archived-profiles",
      {
        method: "POST",
        body: JSON.stringify({ requestKey: "profile-import-click-one" }),
      },
    );
  });

  it.each([
    ["companies", true, 25, null],
    ["contacts", true, 75, null],
    ["complete", false, 100, null],
    ["failed", false, 80, "archive_profile_batch_failed"],
  ] as const)(
    "reads the durable %s status from an encoded run endpoint",
    async (phase, active, processedCount, lastErrorCode) => {
      const status = {
        jobId: "job-one",
        runId: "run / one",
        phase,
        active,
        eligibleCount: 100,
        processedCount,
        createdCount: 40,
        linkedCount: 12,
        updatedCount: 5,
        alreadyImportedCount: 8,
        preservedCount: 10,
        retryableFailureCount: phase === "failed" ? 10 : 0,
        lastErrorCode,
      };
      apiFetch.mockResolvedValue(
        new Response(JSON.stringify(status), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(getArchivedProfileImport("run / one")).resolves.toEqual(
        status,
      );
      expect(apiFetch).toHaveBeenCalledWith(
        "/migration/act-replacement/runs/run%20%2F%20one/import-archived-profiles",
        undefined,
      );
    },
  );
});
