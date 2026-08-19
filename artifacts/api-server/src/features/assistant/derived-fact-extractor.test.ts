import { describe, expect, it } from "vitest";

import {
  parseDerivedFactCandidates,
  type DerivedFactSourceActivity,
} from "./derived-fact-extractor";

const activities: DerivedFactSourceActivity[] = [
  {
    id: "activity-1",
    body: "Price was too high. Asked us to call after the board meeting.",
    occurredAt: "2025-08-10T12:00:00.000Z",
    sourceRecordId: "record-1",
    sourceVersionId: "version-1",
  },
];

describe("parseDerivedFactCandidates", () => {
  it("accepts known facts only when they cite a supplied activity", () => {
    const result = parseDerivedFactCandidates(
      JSON.stringify({
        facts: [
          {
            factKind: "objection",
            summary: "Price was a sticking point.",
            confidence: "high",
            sourceActivityId: "activity-1",
            value: { topic: "price" },
          },
        ],
      }),
      activities,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      factKind: "objection",
      sourceActivityId: "activity-1",
      sourceRecordId: "record-1",
      sourceVersionId: "version-1",
    });
  });

  it("accepts explicit historical pricing as source-linked evidence", () => {
    const [fact] = parseDerivedFactCandidates(
      JSON.stringify({
        facts: [
          {
            factKind: "historical_price",
            summary: "The 2025 event was quoted at $7,500.",
            confidence: "high",
            sourceActivityId: "activity-1",
            value: {
              amount: 7500,
              currency: "USD",
              year: 2025,
              pricingModel: "flat_event_fee",
            },
          },
        ],
      }),
      activities,
    );

    expect(fact).toMatchObject({
      factKind: "historical_price",
      summary: "The 2025 event was quoted at $7,500.",
      confidence: "high",
      sourceActivityId: "activity-1",
      value: {
        amount: 7500,
        currency: "USD",
        year: 2025,
        pricingModel: "flat_event_fee",
      },
    });
  });

  it("drops unknown kinds and invented source ids", () => {
    const result = parseDerivedFactCandidates(
      JSON.stringify({
        facts: [
          { factKind: "secret_score", summary: "No", confidence: "high", sourceActivityId: "activity-1", value: {} },
          { factKind: "objection", summary: "No", confidence: "high", sourceActivityId: "activity-fake", value: {} },
        ],
      }),
      activities,
    );
    expect(result).toEqual([]);
  });

  it("normalizes invalid confidence down to low", () => {
    const [fact] = parseDerivedFactCandidates(
      JSON.stringify({
        facts: [
          { factKind: "promised_follow_up", summary: "Call after the board meeting.", confidence: "certain", sourceActivityId: "activity-1", value: {} },
        ],
      }),
      activities,
    );
    expect(fact?.confidence).toBe("low");
  });

  it("returns no facts for malformed or non-json output", () => {
    expect(parseDerivedFactCandidates("not json", activities)).toEqual([]);
    expect(parseDerivedFactCandidates("{}", activities)).toEqual([]);
  });
});
