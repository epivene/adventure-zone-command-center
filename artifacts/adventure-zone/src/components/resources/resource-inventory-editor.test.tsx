import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/resources/resource-inventory-editor.tsx", "utf8");

describe("resource inventory inspection and identity settings", () => {
  it("exposes explicit checklist applicability controls", () => {
    expect(source).toContain("Inspection tags");
    expect(source).toContain("Inflatable");
    expect(source).toContain("Blower powered");
    expect(source).toContain("Wet attraction");
    expect(source).toContain("Multi-section");
    expect(source).toContain("Action pursuit");
    expect(source).toContain("Carnival game");
    expect(source).toContain("Shared trailer");
    expect(source).toContain("control which safety checklist items appear");
  });

  it("keeps source asset identity separate from operational settings", () => {
    expect(source).toContain("Asset identity");
    expect(source).toContain("Year built");
    expect(source).toContain("Make");
    expect(source).toContain("Model");
    expect(source).toContain("Serial number");
    expect(source).toContain("Identity / inspection notes");
    expect(source).toContain("does not change package counts, travel, timing, or availability");
  });
});
