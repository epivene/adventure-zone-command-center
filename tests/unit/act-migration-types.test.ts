import { describe, expect, it } from "vitest";

import {
  actMigrationRunStatusValues,
  allowedDecisionsForProposal,
  allowedDecisionsForPreviewState,
  isMigrationDecision,
  isMigrationTargetEntityType,
  migrationApplyBatchStatusValues,
  migrationApplyOperationStatusValues,
  migrationDecisionValues,
  migrationIssueCodeValues,
  migrationStreamRank,
  migrationTargetRank,
  relationshipSourceKey,
  sourceRecordKey,
  type ActMigrationStreamType,
  type MigrationTargetEntityType,
} from "@/features/act-migration/migration-types";
import {
  ACT_MIGRATION_APPLY_BATCH_SIZE,
  ACT_MIGRATION_BULK_DECISION_SIZE,
} from "@/features/act-migration/action-limits";

describe("Act migration contracts", () => {
  it("defines the reviewed-import run, decision, batch, and operation contracts", () => {
    expect(migrationDecisionValues).toContain("confirm_static_group");
    expect(actMigrationRunStatusValues).toEqual(
      expect.arrayContaining(["applying", "partially_applied", "applied"]),
    );
    expect(migrationApplyBatchStatusValues).toEqual([
      "pending",
      "applying",
      "partially_applied",
      "applied",
      "failed",
    ]);
    expect(migrationApplyOperationStatusValues).toEqual([
      "pending",
      "leased",
      "blocked",
      "applied",
      "ignored",
      "failed",
    ]);
    expect(ACT_MIGRATION_APPLY_BATCH_SIZE).toBe(25);
    expect(ACT_MIGRATION_BULK_DECISION_SIZE).toBe(100);
  });

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

  it("orders proposal targets by parent dependency", () => {
    const targets: MigrationTargetEntityType[] = [
      "calling_list_member",
      "booking",
      "organization_contact",
      "organization",
      "booking_contact",
      "calling_list",
      "contact",
    ];

    expect(
      targets.toSorted(
        (left, right) => migrationTargetRank(left) - migrationTargetRank(right),
      ),
    ).toEqual([
      "organization",
      "contact",
      "organization_contact",
      "booking",
      "booking_contact",
      "calling_list",
      "calling_list_member",
    ]);
  });

  it("keeps review decisions legal for the specific proposal", () => {
    expect(
      allowedDecisionsForProposal({
        state: "possible_duplicate",
        targetEntityType: "contact",
        issueCode: "ambiguous_person_match",
        candidateLocalIds: [],
      }),
    ).toEqual(["keep_separate", "ignore"]);
    expect(
      allowedDecisionsForProposal({
        state: "possible_duplicate",
        targetEntityType: "organization",
        issueCode: "ambiguous_place_match",
        candidateLocalIds: ["place-1"],
      }),
    ).toEqual(["link_existing", "ignore"]);
    expect(
      allowedDecisionsForProposal({
        state: "needs_review",
        targetEntityType: "contact",
        issueCode: "shared_mailbox_match_blocked",
        candidateLocalIds: ["person-1"],
      }),
    ).toEqual(["link_existing", "keep_separate", "ignore"]);
    expect(
      allowedDecisionsForProposal({
        state: "needs_review",
        targetEntityType: "contact",
        issueCode: "orphaned_external_link",
        candidateLocalIds: [],
      }),
    ).toEqual(["ignore"]);
    expect(
      allowedDecisionsForProposal({
        state: "needs_review",
        targetEntityType: "booking",
        issueCode: "opportunity_place_missing",
        candidateLocalIds: ["booking-1"],
      }),
    ).toEqual(["ignore"]);
    expect(
      allowedDecisionsForProposal({
        state: "needs_review",
        targetEntityType: "calling_list",
        issueCode: "group_membership_semantics_unknown",
        candidateLocalIds: [],
      }),
    ).toEqual(["confirm_static_group", "ignore"]);
    expect(
      allowedDecisionsForProposal({
        state: "error",
        targetEntityType: "contact",
        issueCode: "source_record_error",
        candidateLocalIds: ["person-1"],
      }),
    ).toEqual([]);
  });

  it("exports the complete stable migration issue vocabulary", () => {
    expect(migrationIssueCodeValues).toEqual([
      "ambiguous_person_match",
      "ambiguous_place_match",
      "company_only_contact_unresolved",
      "duplicate_source_id_conflict",
      "group_dynamic_unsupported",
      "group_membership_semantics_unknown",
      "group_target_unavailable",
      "needs_person",
      "opportunity_place_ambiguous",
      "opportunity_place_errored",
      "opportunity_place_location_incomplete",
      "opportunity_place_missing",
      "orphaned_external_link",
      "parent_proposal_unresolved",
      "shared_mailbox_match_blocked",
      "source_record_error",
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
