import { describe, expect, it } from "vitest";
import {
  BUSINESS_SOURCE_CONFLICT_SEEDS,
  BUSINESS_SOURCE_SEEDS,
} from "./business-source-seed";

describe("business source seed", () => {
  it("contains the six reviewed source documents exactly once", () => {
    expect(BUSINESS_SOURCE_SEEDS).toHaveLength(6);
    expect(new Set(BUSINESS_SOURCE_SEEDS.map((source) => source.originalFilename)).size).toBe(6);
    expect(BUSINESS_SOURCE_SEEDS.map((source) => source.originalFilename)).toEqual(
      expect.arrayContaining([
        "ADVENTURE ZONE STICKY NOTES.docx.pdf",
        "Adventure Zone Attended Calendar.xlsx",
        "Inflatable List.pdf",
        "Inflatables (carnival).docx.pdf",
        "pirates rebellion contract.pdf",
        "VENDOR APP 2026.docx",
      ]),
    );
  });

  it("keeps unresolved commercial and operations conflicts explicit", () => {
    expect(BUSINESS_SOURCE_CONFLICT_SEEDS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conflictGroup: "mini_zone_water_barrels", proposedValue: "44" }),
        expect.objectContaining({ conflictGroup: "mini_zone_water_barrels", proposedValue: "50" }),
        expect.objectContaining({ conflictGroup: "package_duration", proposedValue: "1-5" }),
        expect.objectContaining({ conflictGroup: "package_duration", proposedValue: "1-4" }),
        expect.objectContaining({ conflictGroup: "no_upfront_eligibility" }),
      ]),
    );
  });

  it("does not copy sensitive identifiers or private reference lists into source metadata", () => {
    const serialized = JSON.stringify({
      sources: BUSINESS_SOURCE_SEEDS,
      conflicts: BUSINESS_SOURCE_CONFLICT_SEEDS,
    });
    expect(serialized).not.toContain("87-3001810");
    expect(serialized).not.toContain("15615343-003");
    expect(serialized).not.toContain("Keeley Fitzgerald");
    expect(serialized).not.toContain("Dana Escott");
    expect(serialized).not.toContain("Melanie Hatch");
  });
});
