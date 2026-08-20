import { describe, expect, it } from "vitest";

import {
  isNormalizedPaperNoteRegion,
  paperNoteBatchStatusValues,
  paperNoteDestinationModeValues,
} from "./paper-note-types";

describe("paper-note domain contracts", () => {
  it("keeps the approved workflow states exact", () => {
    expect(paperNoteBatchStatusValues).toEqual([
      "draft",
      "queued",
      "extracting",
      "review",
      "importing",
      "imported",
      "failed",
      "archived",
    ]);
    expect(paperNoteDestinationModeValues).toEqual([
      "existing_profile",
      "existing_profile_new_location",
      "new_profile",
      "skip",
    ]);
  });

  it("accepts only normalized regions fully inside the source page", () => {
    expect(
      isNormalizedPaperNoteRegion({
        x: 0.1,
        y: 0.2,
        width: 0.4,
        height: 0.3,
      }),
    ).toBe(true);
    expect(
      isNormalizedPaperNoteRegion({
        x: 0.8,
        y: 0.2,
        width: 0.4,
        height: 0.3,
      }),
    ).toBe(false);
  });
});
