import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildActOrganizeManifest } from "./manifest-builder";
import { digestManifestRows } from "./manifest-digest";
import { manifestFromRows } from "./review-sql-adapter";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("digestManifestRows", () => {
  it("preserves the existing canonical manifest digest", () => {
    const operations = [
      {
        operationKey: "organization:source-1",
        payload: { normalized: { kind: "organization", name: "Adventure Zone" } },
        dependencyOperationKeys: [],
      },
      {
        operationKey: "activity:source-2",
        payload: { normalized: { kind: "timeline", body: "Booked \u2603" } },
        dependencyOperationKeys: ["organization:source-1"],
      },
    ];
    const outcomes = [
      { sourceRecordId: "source-1", state: "ready", operationKeys: ["organization:source-1"] },
      { sourceRecordId: "source-2", state: "ready", operationKeys: ["activity:source-2"] },
    ];
    const expected = createHash("sha256")
      .update(JSON.stringify({ operations, outcomes }))
      .digest("hex");

    expect(digestManifestRows(operations, outcomes)).toBe(expected);
  });

  it("never stringifies the complete manifest arrays", () => {
    const operations = Array.from({ length: 16_252 }, (_, index) => ({
      operationKey: `activity:source-${index}`,
      payload: { normalized: { kind: "timeline", body: "x".repeat(256) } },
    }));
    const outcomes = operations.map((operation, index) => ({
      sourceRecordId: `source-${index}`,
      state: "ready",
      operationKeys: [operation.operationKey],
    }));
    const originalStringify = JSON.stringify.bind(JSON);
    const stringify = vi.spyOn(JSON, "stringify").mockImplementation((value: unknown) => {
      expect(value).not.toBe(operations);
      expect(value).not.toBe(outcomes);
      return originalStringify(value);
    });

    expect(digestManifestRows(operations, outcomes)).toMatch(/^[a-f0-9]{64}$/);
    expect(stringify).toHaveBeenCalledTimes(operations.length + outcomes.length);
  });

  it("keeps both production digest call sites on bounded serialization", () => {
    const originalStringify = JSON.stringify.bind(JSON);
    vi.spyOn(JSON, "stringify").mockImplementation((value: unknown) => {
      if (
        value &&
        typeof value === "object" &&
        "operations" in value &&
        "outcomes" in value
      ) {
        throw new Error("whole_manifest_serialization");
      }
      return originalStringify(value);
    });
    const organized = buildActOrganizeManifest({
      runId: "run-1",
      sources: [
        {
          sourceRecordId: "source-1",
          sourceVersionId: "version-1",
          streamType: "company",
          normalized: { kind: "organization", name: "Adventure Zone" },
          match: { kind: "none", reason: "no_candidate" },
        },
      ],
    });

    expect(organized.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      manifestFromRows({
        operations: organized.operations,
        outcomes: organized.outcomes,
      }).digest,
    ).toBe(organized.digest);
  });
});
