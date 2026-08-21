import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ProfileMemberPicker location profiles", () => {
  it("does not block a profile merely because it is a location of an organization group", () => {
    const source = readFileSync(new URL("./profile-member-picker.tsx", import.meta.url), "utf8");

    const membershipBlock = source.slice(
      source.indexOf("function membershipLabel"),
      source.indexOf("async function search"),
    );
    expect(membershipBlock).not.toContain('parentContext?.kind === "organization_group"');
    expect(membershipBlock).not.toContain("Location of ${candidate.parentContext.name}");
    expect(membershipBlock).toContain("Already in another event family");
  });
});
