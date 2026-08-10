import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryReviewReader, projectReviewRow, readReview, safeSource } from "./review-reader";
import type { ActOrganizeManifest } from "./manifest-builder";

const manifest: ActOrganizeManifest = { digest: "digest-1", operations: [], diagnostics: [], outcomes: [
  { sourceRecordId: "a", sourceVersionId: "v1", state: "unassigned", issues: [{ code: "unassigned" }], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [] },
  { sourceRecordId: "b", sourceVersionId: "v2", state: "ready", issues: [{ code: "unsupported_field", reason: "customFields[]" }], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: ["customFields[]"], operationKeys: [] },
  { sourceRecordId: "c", sourceVersionId: "v3", state: "unsupported", issues: [{ code: "unsupported_record" }], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [] },
] };
describe("Act review reader", () => {
  it("projects a safe context recommendation without exposing raw evidence labels", () => {
    const row = projectReviewRow({
      outcome: {
        sourceRecordId: "company-context",
        sourceVersionId: "v-context",
        state: "awaiting_review",
        issues: [{ code: "field_conflict", reason: "phone" }],
        candidates: [],
        match: {
          kind: "exact",
          localId: "local-company",
          reason: "two_independent_context_clues",
          evidence: [
            { family: "identity", label: "raw private company name", targetEntityType: "organization", targetEntityId: "local-company", authority: "supporting" },
            { family: "web_identity", label: "https://private.example/secret", targetEntityType: "organization", targetEntityId: "local-company", authority: "supporting" },
          ],
        },
        mappingWarnings: [],
        unsupportedFieldPaths: [],
        operationKeys: [],
      },
      source: { sourceRecordId: "company-context", sourceVersionId: "v-context", streamType: "company", display: { Name: "Acme" } },
      targets: [{ id: "local-company", entityType: "organization", label: "Acme", detail: null }],
    });

    expect(row.recommendation).toEqual({
      action: "link_existing",
      target: { id: "local-company", entityType: "organization", label: "Acme", detail: null },
      confidence: "two_independent_clues",
      evidence: [
        { family: "identity", label: "Matching name" },
        { family: "web_identity", label: "Matching website" },
      ],
    });
    expect(JSON.stringify(row)).not.toContain("private.example");
    expect(JSON.stringify(row)).not.toContain("raw private");
  });
  it("paginates/filter rows and returns only safe display data", async () => {
    const reader = new InMemoryReviewReader(); reader.seed("r", manifest, [{ sourceRecordId: "a", sourceVersionId: "v1", streamType: "note", display: { name: "Back call" }, raw: { token: "secret", body: "safe" } }, { sourceRecordId: "b", sourceVersionId: "v2", streamType: "company", display: { name: "Acme" } }]);
    await expect(readReview(reader, { runId: "r", state: "unassigned", pageSize: 25 })).resolves.toMatchObject({ total: 1, manifestDigest: "digest-1", rows: [{ sourceRecordId: "a", display: { name: "Back call" } }] });
    expect(safeSource((await reader.getSource("a"))!, true).raw).toEqual({ body: "safe" });
  });

  it("searches displayed values without matching hidden snapshot-only values", async () => {
    const reader = new InMemoryReviewReader();
    reader.seed("safe-search", {
      digest: "digest-safe-search",
      diagnostics: [],
      operations: [],
      outcomes: [{ sourceRecordId: "safe-search", sourceVersionId: "v1", state: "ready", issues: [], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [] }],
    }, [{
      sourceRecordId: "safe-search",
      sourceVersionId: "v1",
      streamType: "company",
      display: { Name: "Visible Fair", Authorization: "hidden-token" },
      raw: { Name: "Visible Fair", Authorization: "hidden-token" },
    }]);

    await expect(readReview(reader, { runId: "safe-search", search: "hidden-token", pageSize: 25 }))
      .resolves.toMatchObject({ total: 0, rows: [] });
    await expect(readReview(reader, { runId: "safe-search", search: "visible fair", pageSize: 25 }))
      .resolves.toMatchObject({ total: 1, rows: [{ display: { Name: "Visible Fair" } }] });
  });

  it("filters the review queue without mixing in safe records", async () => {
    const reader = new InMemoryReviewReader();
    reader.seed("r", manifest);

    await expect(readReview(reader, { runId: "r", state: "needs_review", pageSize: 25 }))
      .resolves.toMatchObject({
        total: 2,
        rows: [
          { sourceRecordId: "a", state: "unassigned" },
          { sourceRecordId: "c", state: "unsupported" },
        ],
      });
  });

  it("returns global issue counts and sanitized actionable details on a filtered page", async () => {
    const unsupportedFields = Array.from({ length: 50 }, (_, index) => ({
      code: "unsupported_field",
      reason: `CustomFields.Field${index + 1}`,
    }));
    const actionableManifest: ActOrganizeManifest = {
      digest: "digest-actionable",
      diagnostics: [],
      operations: [{
        operationKey: "organization:conflict",
        sourceRecordId: "conflict",
        sourceVersionId: "version-conflict",
        targetType: "organization",
        action: "link_existing",
        payload: {
          normalized: { kind: "organization", name: "Acme", phone: "555-ACT" },
          localId: "local-organization",
          rawSnapshot: { authorization: "never-return-this" },
        },
        dependencyOperationKeys: [],
        requiredForSourceOutcome: true,
        safeByDefault: true,
      }],
      outcomes: [
        { sourceRecordId: "conflict", sourceVersionId: "version-conflict", state: "awaiting_review", issues: [{ code: "field_conflict", reason: "phone" }], candidates: [], match: { kind: "exact", localId: "local-organization" }, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: ["organization:conflict"] },
        { sourceRecordId: "ambiguous", sourceVersionId: "version-ambiguous", state: "awaiting_review", issues: [{ code: "ambiguous_match", reason: "name_only_match_requires_review" }], candidates: [{ candidateId: "local-contact", rawSnapshot: "never-return-this" }], match: { kind: "ambiguous", candidateIds: ["local-contact"] }, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [] },
        { sourceRecordId: "relationship", sourceVersionId: "version-relationship", state: "awaiting_review", issues: [{ code: "relationship_unresolved", reason: "parent_source_not_found" }], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [] },
        { sourceRecordId: "unassigned", sourceVersionId: "version-unassigned", state: "unassigned", issues: [{ code: "unassigned", reason: "no_resolved_parent" }], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [] },
        { sourceRecordId: "unsupported", sourceVersionId: "version-unsupported", state: "unsupported", issues: [{ code: "unsupported_record", reason: "normalization_failed" }], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [] },
        { sourceRecordId: "diagnostics", sourceVersionId: "version-diagnostics", state: "ready", issues: unsupportedFields, candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: unsupportedFields.map((issue) => issue.reason!), operationKeys: [] },
      ],
    };
    const reader = new InMemoryReviewReader();
    reader.seed(
      "run-actionable",
      actionableManifest,
      [
        { sourceRecordId: "conflict", sourceVersionId: "version-conflict", streamType: "company", display: { Name: "Acme", rawSnapshot: "never-return-this" }, raw: { rawSnapshot: "never-return-this" } },
        { sourceRecordId: "ambiguous", sourceVersionId: "version-ambiguous", streamType: "contact", display: { FirstName: "Taako" } },
        { sourceRecordId: "relationship", sourceVersionId: "version-relationship", streamType: "opportunity", display: { Name: "Tour" } },
        { sourceRecordId: "unassigned", sourceVersionId: "version-unassigned", streamType: "note", display: { Subject: "Call back" } },
        { sourceRecordId: "unsupported", sourceVersionId: "version-unsupported", streamType: "unknown", display: { Name: "Unknown" } },
        { sourceRecordId: "diagnostics", sourceVersionId: "version-diagnostics", streamType: "company", display: { Name: "Diagnostic Co" } },
      ],
      [
        { id: "local-organization", entityType: "organization", label: "Acme", detail: "Chicago, IL", fields: { phone: "555-LOCAL" } },
        { id: "local-contact", entityType: "contact", label: "Taako Taaco", detail: "taako@example.com", fields: { email: "taako@example.com" } },
      ],
    );

    const page = await readReview(reader, {
      runId: "run-actionable",
      issue: "field_conflict",
      page: 1,
      pageSize: 25,
    });

    expect(page.summary).toEqual({
      decisionRequired: 5,
      issueCounts: {
        ambiguous_match: 1,
        field_conflict: 1,
        relationship_unresolved: 1,
        unassigned: 1,
        unsupported_record: 1,
      },
      diagnosticCounts: { unsupported_field: 50 },
    });
    expect(page).toMatchObject({
      total: 1,
      rows: [{
        sourceRecordId: "conflict",
        issues: [{ code: "field_conflict", reason: "phone" }],
        conflicts: [{
          fieldName: "phone",
          localValue: "555-LOCAL",
          sourceValue: "555-ACT",
          target: {
            id: "local-organization",
            entityType: "organization",
            label: "Acme",
            detail: "Chicago, IL",
          },
          reviewToken: {
            sourceRecordId: "conflict",
            sourceVersionId: "version-conflict",
            fieldName: "phone",
            sourceValueFingerprint: createHash("sha256").update('{"value":"555-ACT"}').digest("hex"),
            targetEntityType: "organization",
            targetEntityId: "local-organization",
            localValueFingerprint: createHash("sha256").update('{"value":"555-LOCAL"}').digest("hex"),
          },
        }],
        candidates: [],
        canImportStandalone: false,
      }],
    });
    expect(JSON.stringify(page)).not.toContain("rawSnapshot");

    const ambiguous = await readReview(reader, {
      runId: "run-actionable",
      issue: "ambiguous_match",
      pageSize: 25,
    });
    expect(ambiguous.rows[0]).toMatchObject({
      candidates: [{
        id: "local-contact",
        entityType: "contact",
        label: "Taako Taaco",
        detail: "taako@example.com",
      }],
      canImportStandalone: false,
    });
    expect(JSON.stringify(ambiguous)).not.toContain("never-return-this");
  });

  it("projects a stable bound relationship issue even for legacy blockers without slot metadata", async () => {
    const reader = new InMemoryReviewReader();
    reader.seed("legacy-relationship", {
      digest: "legacy-digest",
      diagnostics: [],
      operations: [],
      outcomes: [{
        sourceRecordId: "relationship-source",
        sourceVersionId: "relationship-version",
        state: "awaiting_review",
        issues: [{ code: "relationship_unresolved", reason: "source_relationship_conflict" }],
        candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [],
      }],
    }, [{
      sourceRecordId: "relationship-source", sourceVersionId: "relationship-version",
      streamType: "activity", display: { Subject: "Conflicting call" },
    }]);

    const page = await readReview(reader, { runId: "legacy-relationship", pageSize: 25 });

    expect(page.rows[0]?.relationshipIssues).toEqual([{
      relationshipSlot: expect.stringMatching(/^relationship:/),
      issueCode: "relationship_unresolved",
      reason: "source_relationship_conflict",
      expectedParentTypes: [],
      canImportStandalone: false,
    }]);
  });

  it("prefers a bounded reader page without loading the full manifest or archive", async () => {
    const expected = {
      rows: [], page: 1, pageSize: 25, total: 0, manifestDigest: "digest-bounded",
      summary: { decisionRequired: 0, issueCounts: {}, diagnosticCounts: {} },
    };
    const reader = {
      async getManifest() { throw new Error("full manifest must not be loaded"); },
      async listSources() { throw new Error("full archive must not be loaded"); },
      async readReviewPage() { return expected; },
    };

    await expect(readReview(reader, { runId: "run", pageSize: 25 })).resolves.toBe(expected);
  });

  it("counts every review-state record even when its internal issue is not actionable", async () => {
    const reader = new InMemoryReviewReader();
    reader.seed("run-incomplete", {
      digest: "digest-incomplete",
      diagnostics: [],
      operations: [],
      outcomes: [{
        sourceRecordId: "incomplete",
        sourceVersionId: "version-incomplete",
        state: "awaiting_review",
        issues: [{ code: "archive_incomplete", reason: "required_detail_missing" }],
        candidates: [],
        match: null,
        mappingWarnings: [],
        unsupportedFieldPaths: [],
        operationKeys: [],
      }],
    });

    await expect(readReview(reader, { runId: "run-incomplete", pageSize: 25 }))
      .resolves.toMatchObject({
        summary: { decisionRequired: 1, issueCounts: {}, diagnosticCounts: {} },
      });
  });

  it("matches only normalized allowed target labels with literal wildcard characters", async () => {
    const reader = new InMemoryReviewReader();
    reader.seed("targets", manifest, [], [
      { id: "detail-only", entityType: "organization", label: "No match", detail: "Needle", fields: {} },
      { id: "invalid", entityType: "private_record", label: "Alpha Team", detail: null, fields: {} },
      { id: "underscore", entityType: "booking", label: "Under_score", detail: null, fields: {} },
      { id: "percent", entityType: "organization", label: "100% Real", detail: null, fields: {} },
      { id: "alpha", entityType: "contact", label: "  Alpha   Team ", detail: "private@example.com", fields: {} },
    ]);

    await expect(reader.listAssignmentTargets({ search: "  ALPHA TEAM " }))
      .resolves.toEqual([{ id: "alpha", entityType: "contact", label: "  Alpha   Team ", detail: "private@example.com" }]);
    await expect(reader.listAssignmentTargets({ search: "needle" })).resolves.toEqual([]);
    await expect(reader.listAssignmentTargets({ search: "%" }))
      .resolves.toEqual([{ id: "percent", entityType: "organization", label: "100% Real", detail: null }]);
    await expect(reader.listAssignmentTargets({ search: "_" }))
      .resolves.toEqual([{ id: "underscore", entityType: "booking", label: "Under_score", detail: null }]);
    await expect(reader.listAssignmentTargets({ entityType: "private_record" })).resolves.toEqual([]);
  });

  it("sorts assignment targets deterministically before applying the 25-row cap", async () => {
    const reader = new InMemoryReviewReader();
    reader.seed("targets", manifest, [], Array.from({ length: 30 }, (_, index) => {
      const suffix = String(29 - index).padStart(2, "0");
      return { id: `target-${suffix}`, entityType: "organization", label: `Target ${suffix}`, detail: null, fields: {} };
    }));

    const targets = await reader.listAssignmentTargets({});
    expect(targets).toHaveLength(25);
    expect(targets.map((target) => target.id)).toEqual(
      Array.from({ length: 25 }, (_, index) => `target-${String(index).padStart(2, "0")}`),
    );
  });
});
