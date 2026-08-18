import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/assistant/profile-search-results.tsx", "utf8");

describe("Booking Assistant result cards", () => {
  it("does not render organization/event-family type pills", () => {
    expect(source).not.toContain('result.kind.replace("_", " ")');
    expect(source).not.toContain("uppercase tracking-wide");
  });
});
