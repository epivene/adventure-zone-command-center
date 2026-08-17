import { describe, expect, it } from "vitest";

import { classifyActHistoryForPurge } from "./history-bookkeeping-classifier";

describe("ACT history bookkeeping purge classifier", () => {
  it.each([
    ["Linked to company Crafts - 16th Street Fair", "relationship_bookkeeping"],
    ["Contact Downtown Denver linked", "relationship_bookkeeping"],
    ["Linked to contact Downtown Denver", "relationship_bookkeeping"],
    ["Unlinked from company Old Event", "relationship_bookkeeping"],
    ["Record created", "record_lifecycle_bookkeeping"],
    ["Record updated", "record_lifecycle_bookkeeping"],
    ["Company updated", "record_lifecycle_bookkeeping"],
    ["Status field changed from Open to Closed", "field_change_bookkeeping"],
    ["Phone field updated from 555-1000 to 555-2000", "field_change_bookkeeping"],
  ] as const)("purges machine-only history: %s", (body, reason) => {
    expect(classifyActHistoryForPurge({ subject: null, body })).toEqual({
      purge: true,
      reason,
    });
  });

  it("keeps a real human message containing bookkeeping keywords", () => {
    expect(classifyActHistoryForPurge({
      subject: "Re: contract",
      body: "I updated the contract and linked the invoice below. Please review.",
    })).toEqual({ purge: false });
  });

  it("keeps a meaningful body even when the subject looks like system bookkeeping", () => {
    expect(classifyActHistoryForPurge({
      subject: "Record updated",
      body: "Amy called and asked us to follow up next Tuesday.",
    })).toEqual({ purge: false });
  });

  it("does not purge vague text that only contains a bookkeeping keyword", () => {
    expect(classifyActHistoryForPurge({
      subject: null,
      body: "Status changed after Amy approved the new event plan and asked for a callback.",
    })).toEqual({ purge: false });
  });
});
