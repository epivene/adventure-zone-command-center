import { describe, expect, it } from "vitest";

import { buildDuplicateMergeRequest } from "./duplicate-merge-request";

describe("duplicate merge request", () => {
  it("records an explicit location-conflict review for a manually confirmed location candidate", () => {
    expect(buildDuplicateMergeRequest({
      classification: "location_candidate",
      primaryId: "window-rock",
      duplicateIds: ["st-michaels"],
    })).toEqual({
      primaryId: "window-rock",
      duplicateIds: ["st-michaels"],
      reviewedLocationConflict: true,
    });
  });

  it("does not override location safety for an ordinary duplicate group", () => {
    expect(buildDuplicateMergeRequest({
      classification: "duplicate",
      primaryId: "primary",
      duplicateIds: ["duplicate"],
    })).toEqual({
      primaryId: "primary",
      duplicateIds: ["duplicate"],
    });
  });
});
