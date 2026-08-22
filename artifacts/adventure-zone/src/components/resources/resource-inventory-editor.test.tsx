import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/resources/resource-inventory-editor.tsx", "utf8");

describe("resource inventory inspection tags", () => {
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
});
