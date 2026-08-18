import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/event-families/profile-member-picker.tsx", "utf8");

describe("event family profile picker", () => {
  it("waits for a real search instead of loading unrelated profiles", () => {
    expect(source).not.toContain('void search("")');
    expect(source).toContain("query.trim()");
  });

  it("supports selecting and adding multiple matching profiles", () => {
    expect(source).toContain('type="checkbox"');
    expect(source).toContain("selectedIds");
    expect(source).toContain("Add selected (");
    expect(source).toContain("onSelectMany");
  });
});
