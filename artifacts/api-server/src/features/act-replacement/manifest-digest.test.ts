import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { digestManifestRows } from "./manifest-digest";

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
});
