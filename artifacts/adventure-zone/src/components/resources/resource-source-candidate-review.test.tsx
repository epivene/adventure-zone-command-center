import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/resources/resource-source-candidate-review.tsx", "utf8");

describe("imported asset candidate review", () => {
  it("shows source identity, match state, link, ignore, and normal resource creation guidance", () => {
    for (const text of [
      "Imported asset details",
      "Year built",
      "Make",
      "Model",
      "Serial number",
      "Suggested match",
      "Link",
      "Ignore",
      "Create a normal resource",
    ]) {
      expect(source).toContain(text);
    }
    expect(source).not.toContain("Create resource automatically");
  });
});
