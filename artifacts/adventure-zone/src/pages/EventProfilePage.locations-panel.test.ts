import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("EventProfilePage location mini-workspaces", () => {
  it("mounts ProfileLocationsPanel for the loaded profile", () => {
    const source = readFileSync(new URL("./EventProfilePage.tsx", import.meta.url), "utf8");
    expect(source).toContain('ProfileLocationsPanel');
    expect(source).toContain('<ProfileLocationsPanel profileId={profileId} />');
  });
});
