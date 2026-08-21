import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("full profile location mini-workspaces", () => {
  it("mounts ProfileLocationsPanel from the profile details area", () => {
    const source = readFileSync(new URL("../components/profiles/profile-details-card.tsx", import.meta.url), "utf8");
    expect(source).toContain("ProfileLocationsPanel");
    expect(source).toContain("<ProfileLocationsPanel profileId={profile.id} />");
  });
});
