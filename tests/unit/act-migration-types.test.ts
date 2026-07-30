import { describe, expect, it } from "vitest";

import {
  allowedDecisionsForPreviewState,
  isMigrationDecision,
  isMigrationTargetEntityType,
  migrationStreamRank,
  relationshipSourceKey,
  sourceRecordKey,
  type ActMigrationStreamType,
} from "@/features/act-migration/migration-types";

describe("Act migration contracts", () => {
  it("orders root entities before relationship streams", () => {
    const streams: ActMigrationStreamType[] = [
      "group_contact",
      "opportunity",
      "company_contact",
      "company",
    ];
    expect(
      streams.toSorted(
        (left, right) =>
          migrationStreamRank(left) - migrationStreamRank(right),
      ),
    ).toEqual([
      "company",
      "opportunity",
      "company_contact",
      "group_contact",
    ]);
  });

  it("allows only decisions that can resolve the visible preview state", () => {
    expect(allowedDecisionsForPreviewState("new")).toEqual([
      "approve_proposed",
      "ignore",
    ]);
    expect(allowedDecisionsForPreviewState("matched_unchanged")).toEqual([]);
    expect(allowedDecisionsForPreviewState("possible_duplicate")).toEqual([
      "link_existing",
      "keep_separate",
      "ignore",
    ]);
  });

  it("validates decisions and local proposal targets at runtime", () => {
    expect(isMigrationDecision("link_existing")).toBe(true);
    expect(isMigrationDecision("apply_now")).toBe(false);
    expect(isMigrationTargetEntityType("booking_contact")).toBe(true);
    expect(isMigrationTargetEntityType("company")).toBe(false);
  });

  it("builds deterministic entity and relationship keys", () => {
    expect(sourceRecordKey("company", " ACT-100 ")).toBe("company:ACT-100");
    expect(relationshipSourceKey("company_contact", "COMP-2", "CONTACT-9"))
      .toBe("company_contact:COMP-2:CONTACT-9");
  });

  it("rejects blank and delimiter-bearing source identifiers", () => {
    expect(() => sourceRecordKey("contact", " ")).toThrow(
      "Act! source identifiers must be nonblank.",
    );
    expect(() =>
      relationshipSourceKey("group_contact", "GROUP:2", "CONTACT-9"),
    ).toThrow("Act! source identifiers cannot contain colons.");
  });
});
