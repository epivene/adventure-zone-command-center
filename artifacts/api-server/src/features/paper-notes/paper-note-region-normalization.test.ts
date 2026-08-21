import { describe, expect, it } from "vitest";

import { normalizePaperNoteRegion } from "./paper-note-region-normalization";

describe("normalizePaperNoteRegion", () => {
  it("converts full US state names to postal abbreviations", () => {
    expect(normalizePaperNoteRegion("UTAH")).toBe("UT");
    expect(normalizePaperNoteRegion("Utah")).toBe("UT");
    expect(normalizePaperNoteRegion("North Dakota")).toBe("ND");
  });

  it("keeps existing two-letter abbreviations and leaves unknown regions reviewable", () => {
    expect(normalizePaperNoteRegion("ut")).toBe("UT");
    expect(normalizePaperNoteRegion("Ontario")).toBe("ONTARIO");
    expect(normalizePaperNoteRegion(null)).toBeNull();
  });
});
