import { describe, expect, it } from "vitest";

import {
  GOOGLE_PROFILE_LABEL_ROOT,
  canonicalProfileLabelName,
  isProfileLabelPath,
  normalizedProfileLabelPath,
  readGoogleProfileLabelConfig,
} from "./google-profile-label-config";

describe("Google profile label config", () => {
  it("uses the established Gmail profile hierarchy", () => {
    expect(GOOGLE_PROFILE_LABEL_ROOT).toBe("Z - AdventureZone/Profiles");
    expect(canonicalProfileLabelName("  Elko  County Fair ")).toBe(
      "Z - AdventureZone/Profiles/Elko County Fair",
    );
    expect(isProfileLabelPath(
      "Z - AdventureZone/Profiles/Elko County Fair",
    )).toBe(true);
    expect(isProfileLabelPath("Profiles/Elko County Fair")).toBe(true);
    expect(isProfileLabelPath("Profiles")).toBe(false);
    expect(isProfileLabelPath("Profiles Personal/Elko County Fair")).toBe(false);
  });

  it("enables mutations only for the literal value true", () => {
    expect(readGoogleProfileLabelConfig({} as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(readGoogleProfileLabelConfig({
      GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_ENABLED: "TRUE",
    } as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(readGoogleProfileLabelConfig({
      GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_ENABLED: "true",
    } as NodeJS.ProcessEnv).enabled).toBe(true);
  });

  it("rejects unsafe profile label leaf names", () => {
    for (const name of ["", "A/B", "A\nB", "A\rB", "A\0B"]) {
      expect(() => canonicalProfileLabelName(name)).toThrow(
        "GOOGLE_WORKSPACE_PROFILE_LABEL_NAME_INVALID",
      );
    }
  });

  it("normalizes only for duplicate detection", () => {
    expect(normalizedProfileLabelPath(
      " Z - AdventureZone / Profiles /  ELKO   County Fair ",
    )).toBe("z - adventurezone/profiles/elko county fair");
  });
});
