import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  HAWTHORNE_TERMS,
  RAVALLI_TERMS,
} from "./event-document-term-seed";

const source = readFileSync("src/features/business-sources/event-document-term-seed.ts", "utf8");

describe("historical event document term seed", () => {
  it("keeps the Ravalli negotiated price as a historical contract term only", () => {
    expect(RAVALLI_TERMS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        termKey: "contract.price_cents",
        valueText: "630000",
        valueType: "money_cents",
        sourceLocator: "Contract p.1",
      }),
    ]));
    expect(source).not.toContain("packageTemplates");
    expect(source).not.toContain("basePriceCents");
    expect(source).not.toContain("base_price_cents");
  });

  it("keeps Hawthorne's passed deadline as history and never creates tasks or follow-ups", () => {
    expect(HAWTHORNE_TERMS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        termKey: "application.deadline",
        valueText: "2026-04-25",
        valueType: "date",
      }),
      expect.objectContaining({
        termKey: "application.booth_sizes_warning",
        valueText: expect.stringContaining("not Adventure Zone package footprint approvals"),
      }),
    ]));
    expect(source).not.toContain("officeTasks");
    expect(source).not.toContain("followUps");
    expect(source).not.toContain("dueAt");
  });

  it("does not seed signatures or private legal identifiers", () => {
    const serialized = JSON.stringify({ ravalli: RAVALLI_TERMS, hawthorne: HAWTHORNE_TERMS });
    expect(serialized.toLowerCase()).not.toContain("signature");
    expect(serialized).not.toContain("87-3001810");
    expect(serialized).not.toContain("15615343-003");
  });
});
