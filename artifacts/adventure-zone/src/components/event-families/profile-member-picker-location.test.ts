import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ProfileMemberPicker retired profiles", () => {
  it("uses the eligibility rule instead of describing consolidated profiles as locations", () => {
    const source = readFileSync(new URL("./profile-member-picker.tsx", import.meta.url), "utf8");

    expect(source).toContain("eventFamilyCandidateStatus");
    expect(source).not.toContain("Location of ${candidate.parentContext.name}");
    expect(source).toContain("candidateStatus.blocked");
  });
});
