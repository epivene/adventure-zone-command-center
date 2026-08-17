import { describe, expect, it } from "vitest";

import {
  assistantCacheKey,
  pruneAssistantSnapshots,
  type AssistantCachedSnapshot,
} from "./assistant-offline-cache";

function snapshot(index: number, savedAt: string): AssistantCachedSnapshot {
  return {
    key: `booking:${index}`,
    kind: "booking",
    recordId: String(index),
    label: `Booking ${index}`,
    savedAt,
    context: {
      context: { kind: "booking", recordId: String(index), label: `Booking ${index}` },
      sources: [],
      generatedAt: savedAt,
    },
    brief: { headline: `Booking ${index}`, items: [], generatedAt: savedAt },
  };
}

describe("assistant offline cache", () => {
  it("uses context kind + record id as stable cache key", () => {
    expect(assistantCacheKey({ kind: "booking", recordId: "ABC", label: "X" })).toBe("booking:ABC");
  });

  it("keeps only the newest bounded snapshots", () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      snapshot(index, new Date(Date.UTC(2026, 7, index + 1)).toISOString()),
    );
    const result = pruneAssistantSnapshots(rows, {
      now: new Date("2026-08-26T00:00:00.000Z"),
      maxEntries: 20,
      maxAgeDays: 30,
    });
    expect(result).toHaveLength(20);
    expect(result[0]?.recordId).toBe("24");
    expect(result.at(-1)?.recordId).toBe("5");
  });

  it("removes snapshots older than the age limit", () => {
    const result = pruneAssistantSnapshots(
      [
        snapshot(1, "2026-06-01T00:00:00.000Z"),
        snapshot(2, "2026-08-16T00:00:00.000Z"),
      ],
      { now: new Date("2026-08-17T00:00:00.000Z"), maxEntries: 20, maxAgeDays: 30 },
    );
    expect(result.map((row) => row.recordId)).toEqual(["2"]);
  });
});
