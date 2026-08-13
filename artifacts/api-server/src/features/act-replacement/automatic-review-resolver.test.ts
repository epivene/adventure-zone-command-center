import { describe, expect, it } from "vitest";
import {
  proposeAutomaticReview,
  type AutomaticReviewContext,
  type AutomaticReviewInput,
  type AutomaticReviewSafeDisplay,
} from "./automatic-review-resolver";
import type { ContextClueEvidence } from "./matching/context-clue-resolver";

const record = (overrides: Partial<AutomaticReviewInput["records"][number]> = {}): AutomaticReviewInput["records"][number] => ({
  sourceRecordId: "source-1",
  sourceVersionId: "version-1",
  issues: [],
  ...overrides,
});

const resultFor = (input: AutomaticReviewInput["records"][number]) => proposeAutomaticReview({ records: [input] });

const natalieSource: AutomaticReviewContext["sourceRecords"][number] = {
  sourceRecordId: "source-1",
  sourceVersionId: "version-1",
  streamType: "contact",
  display: { FirstName: " Natalie ", LastName: "Andelin" },
};

const target = (
  id: string,
  entityType = "contact",
  label = "Natalie Andelin",
  fields: Record<string, unknown> = {},
) => ({ id, entityType, label, detail: null, fields });

const context = (
  targetsByEntityType: AutomaticReviewContext["targetsByEntityType"],
  source = natalieSource,
): AutomaticReviewContext => ({ sourceRecords: [source], targetsByEntityType });

const contextualResultFor = (
  input: AutomaticReviewInput["records"][number],
  reviewContext: AutomaticReviewContext,
) => proposeAutomaticReview({ records: [input], context: reviewContext });

const clue = (
  family: ContextClueEvidence["family"],
  targetEntityId = "contact-1",
  overrides: Partial<ContextClueEvidence> = {},
): ContextClueEvidence => ({
  family,
  label: `${family} agrees`,
  targetEntityType: "contact",
  targetEntityId,
  authority: "supporting",
  ...overrides,
});

describe("proposeAutomaticReview", () => {
  it.each([
    {
      name: "does not add an identity decision for a trusted exact external link",
      input: record({ targetEntityType: "organization", match: { kind: "exact", localId: "organization-1", reason: "exact_external_link" } }),
      reviewContext: context({ organization: [target("organization-1", "organization", "Acme")] }, {
        sourceRecordId: "source-1", sourceVersionId: "version-1", streamType: "company", display: { Name: "Acme" },
      }),
      expected: [],
    },
    {
      name: "imports an ambiguous identity as a new record",
      input: record({ issues: [{ code: "ambiguous_match", reason: "multiple_candidates" }], match: { kind: "ambiguous", candidateIds: ["organization-a", "organization-b"], reason: "multiple_candidates" } }),
      reviewContext: undefined,
      expected: [{ kind: "decision", scope: "duplicate_identity", decision: "keep_separate", targetEntityId: null }],
    },
    {
      name: "omits an optional unresolved relationship",
      input: record({ issues: [{ code: "relationship_unresolved", reason: "parent_missing", relationshipSlot: "organization", canImportStandalone: true }] }),
      reviewContext: undefined,
      expected: [{ kind: "decision", scope: "relationship", decision: "keep_unlinked", relationshipSlot: "organization" }],
    },
    {
      name: "assigns a stable relationship slot when a target is supplied",
      input: record({ issues: [{ code: "relationship_unresolved", reason: "parent_missing", relationshipSlot: "organization", expectedParentTypes: ["organization"], canImportStandalone: false, targetEntityType: "organization", targetEntityId: "organization-1" }] }),
      reviewContext: context({ organization: [target("organization-1", "organization", "Acme")] }),
      expected: [{ kind: "decision", scope: "relationship", decision: "assign_parent", relationshipSlot: "organization", targetEntityId: "organization-1" }],
    },
    {
      name: "uses ACT values for each field conflict",
      input: record({ targetEntityType: "organization", match: { kind: "exact", localId: "organization-1", reason: "exact_external_link" }, issues: [{ code: "field_conflict", reason: "phone" }, { code: "field_conflict", reason: "website" }] }),
      reviewContext: context({ organization: [target("organization-1", "organization", "Acme")] }, {
        sourceRecordId: "source-1", sourceVersionId: "version-1", streamType: "company", display: { Name: "Acme" },
      }),
      expected: [
        { kind: "decision", scope: "field_conflict", decision: "use_source", fieldName: "phone" },
        { kind: "decision", scope: "field_conflict", decision: "use_source", fieldName: "website" },
      ],
    },
    {
      name: "ignores an unsupported whole record",
      input: record({ issues: [{ code: "unsupported_record", reason: "normalization_failed" }] }),
      reviewContext: undefined,
      expected: [{ kind: "decision", scope: "unsupported_record", decision: "ignore_source" }],
    },
  ])("$name", ({ input, expected, reviewContext }) => {
    const result = reviewContext ? contextualResultFor(input, reviewContext) : resultFor(input);
    expect(result.proposals).toEqual(expect.arrayContaining(expected.map((proposal) => expect.objectContaining(proposal))));
    expect(result.proposals).toHaveLength(expected.length);
  });

  it("evaluates an unresolved relationship before ambiguous identity fallback", () => {
    const result = resultFor(record({
      issues: [
        { code: "ambiguous_match", reason: "multiple_candidates" },
        { code: "relationship_unresolved", reason: "parent_missing", relationshipSlot: "organization", canImportStandalone: false },
      ],
      match: { kind: "ambiguous", candidateIds: ["organization-a", "organization-b"], reason: "multiple_candidates" },
    }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "relationship_unresolved" }),
    ]);
    expect(result.proposals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "duplicate_identity", decision: "keep_separate" }),
    ]));
  });

  it.each([
    {
      name: "does not assign a required relationship without a target",
      issue: { code: "relationship_unresolved" as const, reason: "parent_missing", relationshipSlot: "organization", expectedParentTypes: ["organization"], canImportStandalone: false },
      reviewContext: undefined,
    },
    {
      name: "does not assign a target with the wrong relationship type",
      issue: { code: "relationship_unresolved" as const, reason: "parent_missing", relationshipSlot: "organization", expectedParentTypes: ["organization"], canImportStandalone: true, targetEntityType: "contact", targetEntityId: "contact-1" },
      reviewContext: context({ contact: [target("contact-1", "contact", "Other Person")] }),
    },
  ])("$name", ({ issue, reviewContext }) => {
    const input = record({
      issues: [issue],
      match: { kind: "ambiguous", candidateIds: ["organization-a", "organization-b"], reason: "multiple_candidates" },
    });
    const result = reviewContext ? contextualResultFor(input, reviewContext) : resultFor(input);

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "relationship_unresolved" }),
    ]);
    expect(result.proposals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "relationship", decision: "assign_parent" }),
      expect.objectContaining({ scope: "duplicate_identity", decision: "keep_separate" }),
    ]));
  });

  it("treats a slotless unassigned issue as manual review before ambiguous fallback", () => {
    const result = resultFor(record({
      issues: [
        { code: "unassigned", reason: "no_resolved_parent" },
        { code: "ambiguous_match", reason: "multiple_candidates" },
      ],
      match: { kind: "ambiguous", candidateIds: ["organization-a", "organization-b"], reason: "multiple_candidates" },
    }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "unassigned" }),
    ]);
    expect(result.proposals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "duplicate_identity", decision: "keep_separate" }),
    ]));
  });

  it.each([
    {
      name: "slotless optional relationship without a target",
      issue: { code: "unassigned" as const, reason: "no_resolved_parent", canImportStandalone: true },
    },
    {
      name: "slotless relationship with an otherwise valid target",
      issue: { code: "relationship_unresolved" as const, reason: "parent_missing", expectedParentTypes: ["organization"], canImportStandalone: true, targetEntityType: "organization", targetEntityId: "organization-1" },
    },
  ])("treats $name as malformed manual review", ({ issue }) => {
    const result = resultFor(record({ issues: [issue] }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: issue.code }),
    ]);
    expect(result.proposals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "relationship", decision: "keep_unlinked" }),
      expect.objectContaining({ scope: "relationship", decision: "assign_parent" }),
    ]));
  });

  it.each([
    {
      name: "preprojected optional relationship without a target",
      issue: { code: "unassigned" as const, reason: "no_resolved_parent", relationshipSlot: "   ", canImportStandalone: true },
    },
    {
      name: "preprojected relationship with an otherwise valid target",
      issue: { code: "relationship_unresolved" as const, reason: "parent_missing", relationshipSlot: "  ", expectedParentTypes: ["organization"], canImportStandalone: true, targetEntityType: "organization", targetEntityId: "organization-1" },
    },
  ])("treats $name with a whitespace-only slot as malformed manual review", ({ issue }) => {
    const result = resultFor(record({ relationshipIssues: [issue] }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: issue.code }),
    ]);
    expect(result.proposals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "relationship", decision: "keep_unlinked" }),
      expect.objectContaining({ scope: "relationship", decision: "assign_parent" }),
    ]));
  });

  it("evaluates required relationship review before unsupported whole-record handling", () => {
    const result = resultFor(record({
      issues: [
        { code: "unsupported_record", reason: "normalization_failed" },
        { code: "relationship_unresolved", reason: "parent_missing", relationshipSlot: "organization", expectedParentTypes: ["organization"], canImportStandalone: false },
      ],
    }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "relationship_unresolved" }),
    ]);
    expect(result.proposals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "unsupported_record", decision: "ignore_source" }),
    ]));
  });

  it("preserves unsupported fields as diagnostics on an otherwise useful record", () => {
    const result = contextualResultFor(record({
      targetEntityType: "organization",
      match: { kind: "exact", localId: "organization-1", reason: "exact_external_link" },
      unsupportedFieldPaths: ["customFields.legacy_code"],
      issues: [{ code: "unsupported_field", reason: "customFields.legacy_code" }],
    }), context({ organization: [target("organization-1", "organization", "Acme")] }, {
      sourceRecordId: "source-1", sourceVersionId: "version-1", streamType: "company", display: { Name: "Acme" },
    }));

    expect(result.proposals).toEqual([]);
    expect(result.proposals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "unsupported_record" }),
    ]));
    expect(result.summary.unsupportedIgnored).toBe(0);
  });

  it("returns deterministic proposals and summary counters", () => {
    const reviewContext: AutomaticReviewContext = {
      sourceRecords: [{ sourceRecordId: "z", sourceVersionId: "version-1", streamType: "company", display: { Name: "Zed" } }],
      targetsByEntityType: { organization: [target("organization-z", "organization", "Zed")] },
    };
    const first = proposeAutomaticReview({ context: reviewContext, records: [
      record({ sourceRecordId: "z", match: { kind: "exact", localId: "organization-z", reason: "exact_external_link" } }),
      record({ sourceRecordId: "a", issues: [{ code: "unsupported_record", reason: "normalization_failed" }] }),
    ] });
    const second = proposeAutomaticReview({ context: reviewContext, records: [
      record({ sourceRecordId: "a", issues: [{ code: "unsupported_record", reason: "normalization_failed" }] }),
      record({ sourceRecordId: "z", match: { kind: "exact", localId: "organization-z", reason: "exact_external_link" } }),
    ] });

    expect(first).toEqual(second);
    expect(first.summary).toMatchObject({ linkedExisting: 0, unsupportedIgnored: 1, decisionsCreatedOrReplayed: 1 });
  });

  it.each(["exact_external_link", "manual_review"])(
    "uses a trusted exact %s target for field proof without reopening identity review",
    (reason) => {
      const result = contextualResultFor(record({
        targetEntityType: "contact",
        match: { kind: "exact", localId: "contact-1", reason },
        issues: [{ code: "field_conflict", reason: "jobTitle" }],
      }), context({
        contact: [target("contact-1", "contact", "Natalie Andelin", { jobTitle: "Local Director" })],
      }));

      expect(result.proposals).toEqual([
        expect.objectContaining({
          scope: "field_conflict",
          decision: "use_source",
          fieldName: "jobTitle",
          targetEntityId: "contact-1",
        }),
      ]);
      expect(result.summary).toMatchObject({ linkedExisting: 0, actValuesSelected: 1, decisionsCreatedOrReplayed: 1 });
    },
  );

  it("trusts an owner-visible exact external target for field proof even when its current label and direct field changed", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      match: { kind: "exact", localId: "contact-1", reason: "exact_external_link" },
      issues: [{ code: "field_conflict", reason: "email" }],
    }), context({
      contact: [target("contact-1", "contact", "Natalie Updated", { email: "local@example.com" })],
    }, {
      ...natalieSource,
      display: { ...natalieSource.display, Email: "act@example.com" },
    }));

    expect(result.proposals).toEqual([
      expect.objectContaining({
        scope: "field_conflict",
        decision: "use_source",
        fieldName: "email",
        targetEntityId: "contact-1",
      }),
    ]);
  });

  it("links one exact normalized Natalie Andelin contact", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "name_only_match_requires_review" }],
      match: { kind: "ambiguous", candidateIds: ["contact-1"], reason: "name_only_match_requires_review" },
    }), context({ contact: [target("contact-1", "contact", "  natalie   andelin ")] }));

    expect(result.proposals).toEqual([
      expect.objectContaining({
        kind: "decision",
        scope: "duplicate_identity",
        decision: "link_existing",
        targetEntityType: "contact",
        targetEntityId: "contact-1",
      }),
    ]);
  });

  it("fails closed before contextual selection when an ambiguous match overflowed", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "name_only_match_requires_review" }],
      match: {
        kind: "ambiguous",
        candidateIds: ["contact-1"],
        overflow: true,
        reason: "name_only_match_requires_review",
        evidence: [clue("archive_relationship", "contact-1", { authority: "authoritative" })],
      },
    }), context({ contact: [target("contact-1")] }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "ambiguous_match" }),
    ]);
    expect(JSON.stringify(result)).not.toContain("contact-1");
  });

  it("does not treat a single-component contact name as an exact full name", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "name_only_match_requires_review" }],
      match: { kind: "ambiguous", candidateIds: ["contact-1"], reason: "name_only_match_requires_review" },
    }), context(
      { contact: [target("contact-1", "contact", "Natalie")] },
      { ...natalieSource, display: { FullName: "Natalie" } },
    ));

    expect(result.proposals).toEqual([
      expect.objectContaining({ scope: "duplicate_identity", decision: "keep_separate", targetEntityId: null }),
    ]);
  });

  it("leaves two exact Natalie Andelin contacts for manual review", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "multiple_name_candidates" }],
      match: { kind: "ambiguous", candidateIds: ["contact-1", "contact-2"], reason: "multiple_name_candidates" },
    }), context({ contact: [target("contact-1"), target("contact-2")] }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "ambiguous_match" }),
    ]);
    expect(result.proposals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "duplicate_identity" }),
    ]));
  });

  it("imports a source separately when no exact full-name target exists", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "name_only_match_requires_review" }],
      match: { kind: "ambiguous", candidateIds: ["contact-1"], reason: "name_only_match_requires_review" },
    }), context({ contact: [target("contact-1", "contact", "Natalie Andelin Smith")] }));

    expect(result.proposals).toEqual([
      expect.objectContaining({
        kind: "decision",
        scope: "duplicate_identity",
        decision: "keep_separate",
        targetEntityId: null,
      }),
    ]);
  });

  it("fails closed when contextual clue families disagree on the target", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "conflicting_context_clues" }],
      match: {
        kind: "ambiguous",
        candidateIds: ["contact-1", "contact-2"],
        reason: "conflicting_context_clues",
        evidence: [clue("direct_contact", "contact-1"), clue("location", "contact-2")],
      },
    }), context({ contact: [
      target("contact-1", "contact", "Not Natalie One"),
      target("contact-2", "contact", "Not Natalie Two"),
    ] }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "ambiguous_match" }),
    ]);
  });

  it.each([
    { name: "email or phone", family: "direct_contact" as const },
    { name: "location", family: "location" as const },
    { name: "archive relationship", family: "archive_relationship" as const },
    { name: "event context", family: "event_context" as const },
    { name: "narrative context", family: "narrative_context" as const },
  ])("links a visible target supported by identity plus $name proof", ({ family }) => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "context_review" }],
      match: {
        kind: "ambiguous",
        candidateIds: ["contact-1"],
        reason: "two_independent_context_clues",
        evidence: [clue("identity"), clue(family)],
      },
    }), context({ contact: [target("contact-1", "contact", "Different Display Name")] }));

    expect(result.proposals).toEqual([
      expect.objectContaining({
        kind: "decision",
        scope: "duplicate_identity",
        decision: "link_existing",
        targetEntityId: "contact-1",
      }),
    ]);
  });

  it("uses web_identity as the canonical company website clue family", () => {
    const result = contextualResultFor(record({
      targetEntityType: "organization",
      issues: [{ code: "ambiguous_match", reason: "context_review" }],
      match: {
        kind: "ambiguous",
        candidateIds: ["organization-1"],
        reason: "two_independent_context_clues",
        evidence: [
          clue("identity", "organization-1", { targetEntityType: "organization" }),
          clue("web_identity", "organization-1", { targetEntityType: "organization" }),
        ],
      },
    }), context(
      { organization: [target("organization-1", "organization", "Different Display Name")] },
      {
        sourceRecordId: "source-1",
        sourceVersionId: "version-1",
        streamType: "company",
        display: { Name: "Acme", Website: "https://acme.example" },
      },
    ));

    expect(result.proposals).toEqual([
      expect.objectContaining({ scope: "duplicate_identity", decision: "link_existing", targetEntityId: "organization-1" }),
    ]);
  });

  it("links a visible target from one authoritative clue", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "context_review" }],
      match: {
        kind: "ambiguous",
        candidateIds: ["contact-1"],
        reason: "authoritative_context_clue",
        evidence: [clue("archive_relationship", "contact-1", { authority: "authoritative" })],
      },
    }), context({ contact: [target("contact-1", "contact", "Different Display Name")] }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ scope: "duplicate_identity", decision: "link_existing", targetEntityId: "contact-1" }),
    ]);
  });

  it("rejects a unique exact name when direct-contact fields conflict", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "name_only_match_requires_review" }],
      match: { kind: "ambiguous", candidateIds: ["contact-1"], reason: "name_only_match_requires_review" },
    }), context(
      { contact: [target("contact-1", "contact", "Natalie Andelin", { email: "other@example.com" })] },
      { ...natalieSource, display: { ...natalieSource.display, Email: "natalie@example.com" } },
    ));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "ambiguous_match" }),
    ]);
  });

  it("fails closed when owner-visible context repeats one target projection", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "name_only_match_requires_review" }],
      match: { kind: "ambiguous", candidateIds: ["contact-1"], reason: "name_only_match_requires_review" },
    }), context({ contact: [
      target("contact-1", "contact", "Natalie Andelin", { email: "natalie@example.com" }),
      target("contact-1", "contact", "Natalie Andelin", { email: "other@example.com" }),
    ] }, {
      ...natalieSource,
      display: { ...natalieSource.display, Email: "natalie@example.com" },
    }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "ambiguous_match" }),
    ]);
  });

  it("does not link proof to a target outside the supplied owner-visible context", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "context_review" }],
      match: {
        kind: "exact",
        localId: "hidden-contact",
        reason: "authoritative_context_clue",
        evidence: [clue("archive_relationship", "hidden-contact", { authority: "authoritative" })],
      },
    }), context({ contact: [] }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "ambiguous_match" }),
    ]);
    expect(JSON.stringify(result)).not.toContain("hidden-contact");
  });

  it("does not link an exact manifest target when owner-visible target context is absent", () => {
    const result = resultFor(record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "context_review" }],
      match: { kind: "exact", localId: "contact-1", reason: "exact_external_link" },
    }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "ambiguous_match" }),
    ]);
    expect(JSON.stringify(result)).not.toContain("contact-1");
  });

  it("does not assign a manifest parent target when owner-visible target context is absent", () => {
    const result = resultFor(record({
      issues: [{
        code: "relationship_unresolved",
        reason: "parent_review",
        relationshipSlot: "organization",
        expectedParentTypes: ["organization"],
        canImportStandalone: false,
        targetEntityType: "organization",
        targetEntityId: "organization-1",
      }],
    }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "relationship_unresolved" }),
    ]);
    expect(JSON.stringify(result)).not.toContain("organization-1");
  });

  it("links a source identity while evaluating a separate unresolved parent slot independently", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [
        { code: "ambiguous_match", reason: "name_only_match_requires_review" },
        {
          code: "relationship_unresolved",
          reason: "company_not_found",
          relationshipSlot: "organization",
          expectedParentTypes: ["organization"],
          canImportStandalone: false,
        },
      ],
      match: { kind: "ambiguous", candidateIds: ["contact-1"], reason: "name_only_match_requires_review" },
    }), context(
      { contact: [target("contact-1")], organization: [] },
      { ...natalieSource, display: { ...natalieSource.display, Company: "Missing Company" } },
    ));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "relationship_unresolved" }),
      expect.objectContaining({ scope: "duplicate_identity", decision: "link_existing", targetEntityId: "contact-1" }),
    ]);
  });

  it("does not reopen a trusted exact identity while a required relationship remains unresolved", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      unsupportedRecord: true,
      issues: [{
        code: "relationship_unresolved",
        reason: "company_not_found",
        relationshipSlot: "organization",
        expectedParentTypes: ["organization"],
        canImportStandalone: false,
      }],
      match: { kind: "exact", localId: "contact-1", reason: "exact_external_link" },
    }), context({ contact: [target("contact-1")], organization: [] }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "relationship_unresolved" }),
    ]);
    expect(result.proposals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "unsupported_record", decision: "ignore_source" }),
    ]));
  });

  it("does not treat a slotted unassigned relationship as an identity issue on a trusted exact link", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [{
        code: "unassigned",
        reason: "company_not_found",
        relationshipSlot: "organization",
        expectedParentTypes: ["organization"],
        canImportStandalone: true,
      }],
      match: { kind: "exact", localId: "contact-1", reason: "exact_external_link" },
    }), context({ contact: [target("contact-1")], organization: [] }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ scope: "relationship", decision: "keep_unlinked", relationshipSlot: "organization" }),
    ]);
  });

  it("resolves stable relationship slots independently and never drops a required slot", () => {
    const result = contextualResultFor(record({
      issues: [
        {
          code: "relationship_unresolved",
          reason: "company_review",
          relationshipSlot: "organization",
          expectedParentTypes: ["organization"],
          canImportStandalone: false,
        },
        {
          code: "relationship_unresolved",
          reason: "contact_review",
          relationshipSlot: "contact",
          expectedParentTypes: ["contact"],
          canImportStandalone: false,
        },
      ],
    }), context(
      {
        organization: [target("organization-1", "organization", "Adventure Zone")],
        contact: [target("wrong-type", "contact", "Adventure Zone")],
      },
      {
        sourceRecordId: "source-1",
        sourceVersionId: "version-1",
        streamType: "activity",
        display: { Company: "Adventure Zone", Contact: "Missing Parent" },
      },
    ));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "relationship_unresolved" }),
      expect.objectContaining({
        scope: "relationship",
        decision: "assign_parent",
        relationshipSlot: "organization",
        targetEntityType: "organization",
        targetEntityId: "organization-1",
      }),
    ]);
    expect(result.summary).toMatchObject({ relationshipsAssigned: 1, manualReview: 1 });
  });

  it("does not compare a child's direct-contact fields with an organization parent", () => {
    const result = contextualResultFor(record({
      issues: [{
        code: "relationship_unresolved",
        reason: "company_review",
        relationshipSlot: "organization",
        expectedParentTypes: ["organization"],
        canImportStandalone: false,
      }],
    }), context(
      { organization: [target("organization-1", "organization", "Adventure Zone", { email: "office@example.com" })] },
      {
        sourceRecordId: "source-1",
        sourceVersionId: "version-1",
        streamType: "contact",
        display: { Company: "Adventure Zone", Email: "natalie@example.com" },
      },
    ));

    expect(result.proposals).toEqual([
      expect.objectContaining({
        scope: "relationship",
        decision: "assign_parent",
        targetEntityType: "organization",
        targetEntityId: "organization-1",
      }),
    ]);
  });

  it("keeps an unresolved relationship unlinked only when standalone import is explicit", () => {
    const optional = contextualResultFor(record({
      issues: [{
        code: "unassigned",
        reason: "parent_not_found",
        relationshipSlot: "organization",
        expectedParentTypes: ["organization"],
        canImportStandalone: true,
      }],
    }), context({ organization: [] }, {
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      streamType: "contact",
      display: { Company: "Missing Company" },
    }));

    expect(optional.proposals).toEqual([
      expect.objectContaining({ scope: "relationship", decision: "keep_unlinked", relationshipSlot: "organization" }),
    ]);
  });

  it("does not reuse one generic contact label across two distinct relationship slots", () => {
    const result = contextualResultFor(record({
      relationshipIssues: [
        {
          code: "relationship_unresolved",
          reason: "primary_contact_review",
          relationshipSlot: "primary-contact",
          expectedParentTypes: ["contact"],
          canImportStandalone: false,
        },
        {
          code: "relationship_unresolved",
          reason: "secondary_contact_review",
          relationshipSlot: "secondary-contact",
          expectedParentTypes: ["contact"],
          canImportStandalone: false,
        },
      ],
    }), context({ contact: [target("contact-1")] }, {
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      streamType: "activity",
      display: { Contact: "Natalie Andelin" },
    }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "relationship_unresolved" }),
      expect.objectContaining({ kind: "manual_review", reason: "relationship_unresolved" }),
    ]);
    expect(result.summary).toMatchObject({ relationshipsAssigned: 0, manualReview: 1 });
  });

  it("uses independent slot-specific labels for two relationships of the same type", () => {
    const result = contextualResultFor(record({
      relationshipIssues: [
        {
          code: "relationship_unresolved",
          reason: "primary_contact_review",
          relationshipSlot: "primary-contact",
          expectedParentTypes: ["contact"],
          canImportStandalone: false,
        },
        {
          code: "relationship_unresolved",
          reason: "secondary_contact_review",
          relationshipSlot: "secondary-contact",
          expectedParentTypes: ["contact"],
          canImportStandalone: false,
        },
      ],
    }), context({ contact: [
      target("contact-natalie", "contact", "Natalie Andelin"),
      target("contact-taako", "contact", "Taako Taaco"),
    ] }, {
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      streamType: "activity",
      display: {},
      relationshipLabelsBySlot: {
        "primary-contact": { contact: "Natalie Andelin" },
        "secondary-contact": { contact: "Taako Taaco" },
      },
    }));

    expect(result.proposals).toEqual([
      expect.objectContaining({
        scope: "relationship",
        decision: "assign_parent",
        relationshipSlot: "primary-contact",
        targetEntityId: "contact-natalie",
      }),
      expect.objectContaining({
        scope: "relationship",
        decision: "assign_parent",
        relationshipSlot: "secondary-contact",
        targetEntityId: "contact-taako",
      }),
    ]);
  });

  it("fails closed for duplicate source projections regardless of input order", () => {
    const input = record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "name_only_match_requires_review" }],
      match: { kind: "ambiguous", candidateIds: ["contact-1"], reason: "name_only_match_requires_review" },
    });
    const projections: AutomaticReviewContext["sourceRecords"] = [
      natalieSource,
      { ...natalieSource, display: { FirstName: "Different", LastName: "Person" } },
    ];
    const resolve = (sourceRecords: AutomaticReviewContext["sourceRecords"]) => contextualResultFor(input, {
      sourceRecords,
      targetsByEntityType: { contact: [target("contact-1")] },
    });

    const first = resolve(projections);
    const second = resolve([...projections].reverse());

    expect(first).toEqual(second);
    expect(first.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "ambiguous_match" }),
    ]);
  });

  it("fails closed for conflicting duplicate relationship representations regardless of input order", () => {
    const issues: AutomaticReviewInput["records"][number]["relationshipIssues"] = [
      {
        code: "relationship_unresolved",
        reason: "parent_review",
        relationshipSlot: "organization",
        expectedParentTypes: ["organization"],
        canImportStandalone: false,
        targetEntityType: "organization",
        targetEntityId: "organization-1",
      },
      {
        code: "relationship_unresolved",
        reason: "parent_review",
        relationshipSlot: "organization",
        expectedParentTypes: ["organization"],
        canImportStandalone: false,
        targetEntityType: "organization",
        targetEntityId: "organization-2",
      },
    ];
    const resolve = (relationshipIssues: NonNullable<typeof issues>) => contextualResultFor(
      record({ relationshipIssues }),
      context({ organization: [
        target("organization-1", "organization", "One"),
        target("organization-2", "organization", "Two"),
      ] }),
    );

    const first = resolve(issues!);
    const second = resolve([...issues!].reverse());

    expect(first).toEqual(second);
    expect(first.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "relationship_unresolved" }),
    ]);
    expect(JSON.stringify(first)).not.toContain("organization-1");
    expect(JSON.stringify(first)).not.toContain("organization-2");
  });

  it.each([
    {
      name: "issue code",
      first: {
        code: "relationship_unresolved" as const,
        reason: "parent_review",
        relationshipSlot: "organization",
        expectedParentTypes: ["organization"],
        canImportStandalone: false,
        targetEntityType: "organization",
        targetEntityId: "organization-1",
      },
      second: {
        code: "unassigned" as const,
        reason: "parent_review",
        relationshipSlot: "organization",
        expectedParentTypes: ["organization"],
        canImportStandalone: false,
        targetEntityType: "organization",
        targetEntityId: "organization-1",
      },
    },
    {
      name: "reason",
      first: {
        code: "relationship_unresolved" as const,
        reason: "parent_missing",
        relationshipSlot: "organization",
        expectedParentTypes: ["organization"],
        canImportStandalone: false,
        targetEntityType: "organization",
        targetEntityId: "organization-1",
      },
      second: {
        code: "relationship_unresolved" as const,
        reason: "parent_conflict",
        relationshipSlot: "organization",
        expectedParentTypes: ["organization"],
        canImportStandalone: false,
        targetEntityType: "organization",
        targetEntityId: "organization-1",
      },
    },
  ])("fails closed when representations of one stable slot disagree on $name", ({ first, second }) => {
    const resolve = (relationshipIssues: AutomaticReviewInput["records"][number]["relationshipIssues"]) => contextualResultFor(
      record({ relationshipIssues }),
      context({ organization: [
        target("organization-1", "organization", "One"),
        target("organization-2", "organization", "Two"),
      ] }),
    );

    const forward = resolve([first, second]);
    const reversed = resolve([second, first]);

    expect(forward).toEqual(reversed);
    expect(forward.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review" }),
    ]);
    expect(JSON.stringify(forward)).not.toContain("organization-1");
    expect(JSON.stringify(forward)).not.toContain("organization-2");
  });

  it.each([
    {
      name: "email",
      first: { Email: "natalie@example.com", EmailAddress: "other@example.com" },
      second: { EmailAddress: "other@example.com", Email: "natalie@example.com" },
      targetFields: { email: "natalie@example.com" },
    },
    {
      name: "phone",
      first: { Phone: "312-555-0100", BusinessPhone: "312-555-0199" },
      second: { BusinessPhone: "312-555-0199", Phone: "312-555-0100" },
      targetFields: { phone: "312-555-0100" },
    },
  ])("fails closed for conflicting source $name aliases regardless of insertion order", ({ first, second, targetFields }) => {
    const input = record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "name_only_match_requires_review" }],
      match: { kind: "ambiguous", candidateIds: ["contact-1"], reason: "name_only_match_requires_review" },
    });
    const resolve = (aliases: AutomaticReviewSafeDisplay) => contextualResultFor(input, context(
      { contact: [target("contact-1", "contact", "Natalie Andelin", targetFields)] },
      { ...natalieSource, display: { ...natalieSource.display, ...aliases } },
    ));

    const firstResult = resolve(first);
    const secondResult = resolve(second);

    expect(firstResult).toEqual(secondResult);
    expect(firstResult.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "ambiguous_match" }),
    ]);
  });

  it("fails closed for conflicting target direct-contact aliases regardless of insertion order", () => {
    const input = record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "name_only_match_requires_review" }],
      match: { kind: "ambiguous", candidateIds: ["contact-1"], reason: "name_only_match_requires_review" },
    });
    const resolve = (fields: Record<string, string>) => contextualResultFor(input, context(
      { contact: [target("contact-1", "contact", "Natalie Andelin", fields)] },
      { ...natalieSource, display: { ...natalieSource.display, Email: "natalie@example.com" } },
    ));

    const first = resolve({ email: "natalie@example.com", emailAddress: "other@example.com" });
    const second = resolve({ emailAddress: "other@example.com", email: "natalie@example.com" });

    expect(first).toEqual(second);
    expect(first.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "ambiguous_match" }),
    ]);
  });

  it("fails closed when a runtime caller supplies a nested non-allowlisted display value", () => {
    const unsafeSource = {
      ...natalieSource,
      display: {
        ...natalieSource.display,
        rawSnapshot: { authorization: "secret" },
      },
    } as unknown as AutomaticReviewContext["sourceRecords"][number];
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "name_only_match_requires_review" }],
      match: { kind: "ambiguous", candidateIds: ["contact-1"], reason: "name_only_match_requires_review" },
    }), context({ contact: [target("contact-1")] }, unsafeSource));

    expect(result.proposals).toEqual([
      expect.objectContaining({ kind: "manual_review", reason: "ambiguous_match" }),
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("accepts additional allowlisted scalar review-display fields", () => {
    const result = contextualResultFor(record({
      targetEntityType: "contact",
      issues: [{ code: "ambiguous_match", reason: "name_only_match_requires_review" }],
      match: { kind: "ambiguous", candidateIds: ["contact-1"], reason: "name_only_match_requires_review" },
    }), context({ contact: [target("contact-1")] }, {
      ...natalieSource,
      display: {
        ...natalieSource.display,
        JobTitle: "Producer",
        City: "Chicago",
        Region: "Illinois",
      },
    }));

    expect(result.proposals).toEqual([
      expect.objectContaining({ scope: "duplicate_identity", decision: "link_existing", targetEntityId: "contact-1" }),
    ]);
  });
});
