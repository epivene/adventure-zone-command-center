import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildActOrganizeManifest, type ManifestSourceInput } from "./manifest-builder";
import { normalizeTimeline } from "./normalizers/timeline-normalizer";

const source = (overrides: Partial<ManifestSourceInput> = {}): ManifestSourceInput => ({
  sourceRecordId: "s-1", sourceVersionId: "v-1", streamType: "company",
  normalized: { kind: "organization", name: "Acme", phone: null, website: null },
  match: { kind: "none", reason: "no_candidate" }, warnings: [], unsupportedFieldPaths: [],
  ...overrides,
});

const unsupportedSource: ManifestSourceInput = {
  sourceRecordId: "unsupported-company",
  sourceVersionId: "unsupported-version",
  streamType: "company",
  normalized: null,
  match: { kind: "none", reason: "normalization_failed" },
  warnings: [],
  unsupportedFieldPaths: [],
  provenance: [],
};

const reviewDecision = {
  decisionId: "decision-1",
  sourceVersionId: "v-1",
  scope: "field_conflict" as const,
  decision: "keep_local" as const,
  fieldName: "phone",
  targetEntityType: "organization",
  targetEntityId: "organization-1",
  decidedBy: "owner",
  createdAt: "2026-08-08T00:00:00.000Z",
};

describe("buildActOrganizeManifest", () => {
  it("gives changed exact identity targets distinct operation keys", () => {
    const build = (localId: string) => buildActOrganizeManifest({ runId: "run", sources: [source({
      match: { kind: "exact", localId, reason: "manual_assignment" },
    })] }).operations.find((operation) => operation.action === "link_existing")?.operationKey;

    expect(build("organization-1")).not.toBe(build("organization-2"));
  });

  it("keeps parent source lookup growth near-linear", () => {
    const lookupCount = (size: number) => {
      let lookups = 0;
      const trackedSource = (value: ManifestSourceInput) => {
        const sourceRecordId = value.sourceRecordId;
        Object.defineProperty(value, "sourceRecordId", {
          enumerable: true,
          get() {
            lookups += 1;
            return sourceRecordId;
          },
        });
        return value;
      };
      const parentId = "zz-parent";
      const sources: ManifestSourceInput[] = [trackedSource(source({
        sourceRecordId: parentId,
        sourceVersionId: "parent-version",
        normalized: { kind: "organization", name: "Parent" },
      }))];
      for (let index = 0; index < size; index += 1) {
        sources.push(trackedSource(source({
          sourceRecordId: `timeline-${String(index).padStart(4, "0")}`,
          sourceVersionId: `timeline-version-${index}`,
          streamType: "activity",
          normalized: { kind: "timeline", body: `Activity ${index}` },
          relationships: { organizationSourceIds: [parentId] },
        })));
      }

      buildActOrganizeManifest({ runId: "run", sources });
      return lookups;
    };

    const small = lookupCount(80);
    const large = lookupCount(160);
    expect(large / small).toBeLessThan(3);
  });

  it("orders parent creation before relationships and provenance", () => {
    const result = buildActOrganizeManifest({ runId: "run", sources: [
      source({ sourceRecordId: "contact", sourceVersionId: "cv", streamType: "contact", normalized: { kind: "contact", firstName: "A", lastName: "B", email: null, phone: null } }),
      source({ sourceRecordId: "company", sourceVersionId: "ov", streamType: "company", normalized: { kind: "organization", name: "Org", phone: null, website: null } }),
      source({ sourceRecordId: "activity", sourceVersionId: "av", streamType: "activity", normalized: { kind: "timeline", category: "calendar", sourceType: "activity", body: "Call", subject: null, sourceOccurredAt: null, timelineSortAt: "2026-01-01T00:00:00.000Z", dateIsImportFallback: true, endsAt: null, status: null }, relationships: { organizationSourceIds: ["company"], contactSourceIds: ["contact"], bookingSourceIds: [] } }),
    ]});
    expect(result.operations.map((operation) => operation.targetType)).toEqual([
      "organization", "contact", "activity", "activity_association", "activity_association", "activity", "organization", "contact",
    ]);
    expect(result.operations[2]?.dependencyOperationKeys).toEqual([]);
    expect(result.operations.filter((operation) => operation.targetType === "activity_association").map((operation) => operation.dependencyOperationKeys)).toEqual([
      ["activity:activity", "organization:company"], ["activity:activity", "contact:contact"],
    ]);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is permutation independent and does not auto-apply ambiguous matches", () => {
    const inputs = [source(), source({ sourceRecordId: "s-2", sourceVersionId: "v-2", match: { kind: "ambiguous", candidateIds: ["z", "a"], reason: "name_only" } })];
    const first = buildActOrganizeManifest({ runId: "run", sources: inputs });
    const second = buildActOrganizeManifest({ runId: "run", sources: [...inputs].reverse() });
    expect(second).toEqual(first);
    expect(first.outcomes.find((row) => row.sourceRecordId === "s-2")).toMatchObject({ state: "awaiting_review", issues: [{ code: "ambiguous_match" }] });
    expect(first.operations.find((row) => row.sourceRecordId === "s-2")).toBeUndefined();
  });

  it("imports supported fields while retaining archived-only field diagnostics", () => {
    const result = buildActOrganizeManifest({ runId: "run", sources: [source({ warnings: ["bad field", "bad field"], unsupportedFieldPaths: ["secret.value"] })] });
    expect(result.diagnostics).toEqual([{ code: "unsupported_field", sourceRecordId: "s-1", path: "secret.value" }]);
    expect(result.outcomes[0]).toMatchObject({
      state: "ready",
      issues: [{ code: "unsupported_field", reason: "secret.value" }],
    });
    expect(result.operations).toContainEqual(expect.objectContaining({
      sourceRecordId: "s-1",
      targetType: "organization",
      action: "create",
      safeByDefault: true,
    }));
    expect(result.operations).toContainEqual(expect.objectContaining({
      sourceRecordId: "s-1",
      targetType: "organization",
      action: "record_provenance",
      payload: expect.objectContaining({ unsupportedFieldPaths: ["secret.value"] }),
    }));
    expect(result.digest).toBe(createHash("sha256").update(JSON.stringify({ operations: result.operations, outcomes: result.outcomes })).digest("hex"));
  });

  it("persists sorted context evidence and records only sanitized clue provenance", () => {
    const result = buildActOrganizeManifest({ runId: "run", sources: [source({
      match: {
        kind: "exact",
        localId: "organization-1",
        reason: "two_independent_context_clues",
        evidence: [
          { family: "web_identity", label: "website agrees", targetEntityType: "organization", targetEntityId: "organization-1", authority: "supporting" },
          { family: "identity", label: "organization name agrees", targetEntityType: "organization", targetEntityId: "organization-1", authority: "supporting" },
        ],
      },
      localFields: { name: "Acme" },
      unsupportedFieldPaths: ["customFields.Legacy"],
    })] });

    expect(result.outcomes[0]?.match).toMatchObject({
      kind: "exact",
      localId: "organization-1",
      evidence: [
        expect.objectContaining({ family: "identity" }),
        expect.objectContaining({ family: "web_identity" }),
      ],
    });
    expect(result.operations.find((operation) => operation.action === "record_provenance")?.payload).toMatchObject({
      matchEvidenceFamilies: ["identity", "web_identity"],
      unsupportedFieldPaths: ["customFields.Legacy"],
    });
  });

  it("persists bounded automatic proof for only policy-approved operations", () => {
    const result = buildActOrganizeManifest({ runId: "run", sources: [
      source({
        sourceRecordId: "safe-create",
        sourceVersionId: "safe-create-version",
      }),
      source({
        sourceRecordId: "proven-link",
        sourceVersionId: "proven-link-version",
        normalized: {
          kind: "organization",
          name: "Proven",
          phone: null,
          website: "https://proven.example",
        },
        match: {
          kind: "exact",
          localId: "organization-proven",
          reason: "two_independent_context_clues",
          evidence: [
            { family: "identity", label: "name agrees", targetEntityType: "organization", targetEntityId: "organization-proven", authority: "supporting" },
            { family: "web_identity", label: "website agrees", targetEntityType: "organization", targetEntityId: "organization-proven", authority: "supporting" },
          ],
        },
        localFields: { name: "Proven", website: null },
      }),
      source({
        sourceRecordId: "weak-link",
        sourceVersionId: "weak-link-version",
        match: {
          kind: "exact",
          localId: "organization-weak",
          reason: "two_independent_context_clues",
          evidence: [
            { family: "identity", label: "only one weak clue", targetEntityType: "organization", targetEntityId: "organization-weak", authority: "supporting" },
          ],
        },
        localFields: { name: "Acme" },
      }),
      source({
        sourceRecordId: "contact-child",
        sourceVersionId: "contact-child-version",
        streamType: "contact",
        normalized: { kind: "contact", firstName: "Child", lastName: "Contact" },
        relationships: { organizationSourceIds: ["safe-create"] },
      }),
    ] });

    const automaticProof = (sourceRecordId: string, action: string) =>
      result.operations.find((operation) =>
        operation.sourceRecordId === sourceRecordId && operation.action === action
      )?.payload.automaticReview;

    expect(automaticProof("safe-create", "create")).toMatchObject({
      version: 1,
      eligible: true,
      disposition: "safe_ready",
      basis: "safe_create",
    });
    expect(automaticProof("proven-link", "link_existing")).toMatchObject({
      eligible: true,
      disposition: "auto_resolved",
      basis: "proven_context_match",
    });
    expect(automaticProof("proven-link", "fill_missing")).toMatchObject({
      eligible: true,
      disposition: "auto_resolved",
    });
    expect(automaticProof("weak-link", "link_existing")).toMatchObject({
      eligible: false,
      disposition: "archived_only",
      basis: "not_automatically_safe",
    });
    expect(automaticProof("contact-child", "create_relationship")).toMatchObject({
      eligible: false,
      basis: "not_automatically_safe",
    });
    expect(automaticProof("proven-link", "record_provenance")).toMatchObject({
      eligible: true,
      disposition: "auto_resolved",
      basis: "dependency_closed_provenance",
    });
    expect(JSON.stringify(automaticProof("proven-link", "link_existing")))
      .not.toContain("website agrees");
  });

  it("emits fill operations only for supported contact fields and ignores matching metadata", () => {
    const result = buildActOrganizeManifest({ runId: "run", sources: [source({
      streamType: "contact",
      normalized: {
        kind: "contact", firstName: "Jane", lastName: "Doe", email: "jane@example.com",
        emailIdentityMatchSafe: true, phone: null, jobTitle: null,
        address1: "1 Main St", address2: "Suite 2", city: "Denver", region: "CO", postalCode: "80202",
      },
      match: { kind: "exact", localId: "contact-1", reason: "exact_external_link" },
      localFields: {
        firstName: "Jane", lastName: "Doe", email: null, phone: null, jobTitle: null,
        address1: null, address2: null, city: null, region: null, postalCode: null,
      },
    })] });

    const fillFields = result.operations
      .filter((operation) => operation.action === "fill_missing")
      .map((operation) => operation.payload.fieldName);
    expect(fillFields).toEqual(["address1", "address2", "city", "email", "postalCode", "region"]);
    expect(fillFields).not.toContain("emailIdentityMatchSafe");
    expect(result.outcomes[0]).toMatchObject({ state: "ready", issues: [] });
  });

  it("shares writable organization industry and address mappings with apply", () => {
    const result = buildActOrganizeManifest({ runId: "run", sources: [source({
      normalized: {
        kind: "organization", name: "Acme", phone: null, website: null,
        industry: "Performing Arts", address1: null, address2: "Floor 3", city: null, region: null, postalCode: null,
      },
      match: { kind: "exact", localId: "organization-1", reason: "exact_external_link" },
      localFields: { name: "Acme", industry: null, address2: null },
    })] });

    expect(result.operations.filter((operation) => operation.action === "fill_missing").map((operation) => operation.payload.fieldName))
      .toEqual(["address2", "industry"]);
    expect(result.outcomes[0]).toMatchObject({ state: "ready", issues: [] });
  });

  it("keeps unsupported fields as diagnostics without blocking supported operations", () => {
    const manifest = buildActOrganizeManifest({ runId: "run",
      sources: [{
        sourceRecordId: "company-1",
        sourceVersionId: "version-1",
        streamType: "company",
        normalized: { kind: "organization", name: "County Fair", phone: "555-0100", customLegacyCode: "A-17" },
        match: { kind: "none", reason: "no_match" },
        warnings: [],
        unsupportedFieldPaths: ["Custom Fields.Legacy Code"],
        provenance: [],
      }],
    });

    expect(manifest.outcomes[0]).toMatchObject({ state: "ready" });
    expect(manifest.outcomes[0].issues).toEqual(expect.arrayContaining([
      { code: "unsupported_field", reason: "customLegacyCode" },
    ]));
    expect(manifest.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetType: "organization", action: "create" }),
    ]));
    expect(manifest.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "record_provenance",
        payload: expect.objectContaining({ unsupportedNormalizedFields: ["customLegacyCode"] }),
      }),
    ]));
    expect(manifest.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsupported_field", sourceRecordId: "company-1" }),
    ]));
  });

  it("does not invent an operation for an unsupported whole record", () => {
    const manifest = buildActOrganizeManifest({ runId: "run", sources: [unsupportedSource] });
    expect(manifest.outcomes[0]).toMatchObject({ state: "unsupported", operationKeys: [] });
    expect(manifest.operations).toEqual([]);
  });

  it("resolves a field conflict by keeping the local value", () => {
    const manifest = buildActOrganizeManifest({ runId: "run", sources: [source({
      localFields: { phone: "555-LOCAL" },
      normalized: { kind: "organization", name: "Acme", phone: "555-ACT", website: null },
      match: { kind: "exact", localId: "organization-1", reason: "exact_external_link" },
      reviewDecisions: [reviewDecision],
    })] });

    expect(manifest.outcomes[0]?.issues).not.toContainEqual(expect.objectContaining({ code: "field_conflict" }));
    expect(manifest.operations).not.toContainEqual(expect.objectContaining({ action: "overwrite_reviewed" }));
  });

  it("materializes an explicit Act overwrite with immutable proof", () => {
    const manifest = buildActOrganizeManifest({ runId: "run", sources: [source({
      localFields: { phone: "555-CHANGED-AFTER-REVIEW" },
      normalized: { kind: "organization", name: "Acme", phone: "555-CHANGED-ACT", website: null },
      match: { kind: "exact", localId: "organization-1", reason: "exact_external_link" },
      reviewDecisions: [{
        ...reviewDecision,
        decisionId: "decision-2",
        decision: "use_source",
        reviewedSourceValue: "555-ACT",
        reviewedSourceValueFingerprint: createHash("sha256").update('{"value":"555-ACT"}').digest("hex"),
        reviewedLocalValue: "555-LOCAL",
        reviewedLocalValueFingerprint: createHash("sha256").update('{"value":"555-LOCAL"}').digest("hex"),
      }],
    })] });

    expect(manifest.operations).toContainEqual(expect.objectContaining({
      action: "overwrite_reviewed",
      safeByDefault: false,
      payload: expect.objectContaining({
        entityId: "organization-1",
        fieldName: "phone",
        value: "555-ACT",
        decision: expect.objectContaining({ id: "decision-2", sourceVersionId: "v-1" }),
        proof: expect.objectContaining({
          entityType: "organization",
          entityId: "organization-1",
          fieldName: "phone",
          sourceVersionId: "v-1",
          expectedLocalValueFingerprint: createHash("sha256").update('{"value":"555-LOCAL"}').digest("hex"),
          decisionId: "decision-2",
          decision: "use_source",
          localValue: "555-LOCAL",
          sourceValue: "555-ACT",
        }),
      }),
    }));
  });

  it("keeps exact identity links safe while reviewed overwrites stay proof-gated", () => {
    const manifest = buildActOrganizeManifest({
      runId: "run",
      sources: [source({
        localFields: { phone: "555-LOCAL" },
        normalized: { kind: "organization", name: "Acme", phone: "555-ACT", website: null },
        match: { kind: "exact", localId: "organization-1", reason: "exact_external_link" },
        reviewDecisions: [{
          ...reviewDecision,
          decisionId: "decision-safe-link",
          decision: "use_source",
          reviewedSourceValue: "555-ACT",
          reviewedSourceValueFingerprint: createHash("sha256").update('{"value":"555-ACT"}').digest("hex"),
          reviewedLocalValue: "555-LOCAL",
          reviewedLocalValueFingerprint: createHash("sha256").update('{"value":"555-LOCAL"}').digest("hex"),
        }],
      })],
    });

    expect(manifest.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationKey: "organization:s-1:identity:organization-1",
        action: "link_existing",
        safeByDefault: true,
      }),
      expect.objectContaining({
        operationKey: "organization:s-1:field:phone:decision:decision-safe-link",
        action: "overwrite_reviewed",
        dependencyOperationKeys: ["organization:s-1:identity:organization-1"],
        safeByDefault: false,
      }),
    ]));
  });

  it("rebuilds deterministic safe context links while preserving manual targets and populated-field conflicts", () => {
    // Protects against input-order-dependent manifests, leaking raw clue
    // labels into operations, or silently turning a populated-field conflict
    // into an automatic overwrite.
    const inputs = [
      source({
        sourceRecordId: "two-clue-context",
        sourceVersionId: "two-clue-version",
        match: {
          kind: "exact",
          localId: "organization-context",
          reason: "two_independent_context_clues",
          evidence: [
            {
              family: "web_identity",
              label: "website agrees with https://example.test/private-path",
              targetEntityType: "organization",
              targetEntityId: "organization-context",
              authority: "supporting",
            },
            {
              family: "identity",
              label: "name agrees with the archived organization",
              targetEntityType: "organization",
              targetEntityId: "organization-context",
              authority: "supporting",
            },
          ],
        },
        localFields: { name: "Acme" },
      }),
      source({
        sourceRecordId: "manual-target",
        sourceVersionId: "manual-version",
        match: {
          kind: "exact",
          localId: "organization-chosen-by-review",
          reason: "manual_review",
        },
        localFields: { name: "Acme" },
      }),
      source({
        sourceRecordId: "populated-conflict",
        sourceVersionId: "conflict-version",
        normalized: {
          kind: "organization",
          name: "Acme",
          phone: "555-ACT",
          website: "https://example.test",
        },
        match: {
          kind: "exact",
          localId: "organization-conflict",
          reason: "exact_external_link",
        },
        localFields: { name: "Acme", phone: "555-LOCAL", website: null },
      }),
    ];

    const first = buildActOrganizeManifest({ runId: "run", sources: inputs });
    const reordered = buildActOrganizeManifest({
      runId: "run",
      sources: [...inputs].reverse(),
    });
    const rebuilt = buildActOrganizeManifest({ runId: "run", sources: inputs });

    expect(reordered).toEqual(first);
    expect(rebuilt).toEqual(first);
    expect(rebuilt.digest).toBe(first.digest);
    expect(first.operations).toContainEqual(expect.objectContaining({
      sourceRecordId: "two-clue-context",
      action: "link_existing",
      safeByDefault: true,
      payload: expect.objectContaining({ localId: "organization-context" }),
    }));
    const twoClueProvenance = first.operations.find(
      (operation) => operation.sourceRecordId === "two-clue-context" && operation.action === "record_provenance",
    );
    expect(twoClueProvenance?.payload).toMatchObject({
      matchEvidenceFamilies: ["identity", "web_identity"],
    });
    expect(JSON.stringify(twoClueProvenance?.payload)).not.toContain("private-path");
    expect(first.operations.find(
      (operation) => operation.sourceRecordId === "two-clue-context" && operation.action === "link_existing",
    )?.payload).not.toHaveProperty("decision");
    expect(first.operations).toContainEqual(expect.objectContaining({
      sourceRecordId: "manual-target",
      action: "link_existing",
      payload: expect.objectContaining({ localId: "organization-chosen-by-review" }),
    }));
    expect(first.outcomes).toContainEqual(expect.objectContaining({
      sourceRecordId: "populated-conflict",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "field_conflict", reason: "phone" }),
      ]),
    }));
    expect(first.operations).toContainEqual(expect.objectContaining({
      sourceRecordId: "populated-conflict",
      action: "link_existing",
      safeByDefault: true,
    }));
    expect(first.operations).not.toContainEqual(expect.objectContaining({
      sourceRecordId: "populated-conflict",
      action: "overwrite_reviewed",
    }));
  });

  it("keeps an explicitly ignored unsupported record archived and resolved", () => {
    const manifest = buildActOrganizeManifest({ runId: "run", sources: [{
      ...unsupportedSource,
      reviewDecisions: [{ ...reviewDecision, decisionId: "decision-3", sourceVersionId: "unsupported-version", scope: "unsupported_record", decision: "ignore_source", fieldName: null }],
    }] });

    expect(manifest.outcomes[0]).toMatchObject({ state: "ignored", operationKeys: [] });
  });

  it("imports a valid standalone timeline only after an explicit relationship decision", () => {
    const manifest = buildActOrganizeManifest({ runId: "run", sources: [source({
      sourceRecordId: "timeline-1",
      streamType: "activity",
      normalized: { kind: "timeline", category: "note", sourceType: "activity", body: "Standalone", subject: null, sourceOccurredAt: null, timelineSortAt: "2026-08-08T00:00:00.000Z", dateIsImportFallback: true, endsAt: null, status: null },
      reviewDecisions: [{ ...reviewDecision, decisionId: "decision-4", scope: "relationship", decision: "keep_unlinked", fieldName: null }],
    })] });

    expect(manifest.outcomes[0]).toMatchObject({ state: "ready" });
    expect(manifest.operations).toContainEqual(expect.objectContaining({ targetType: "activity", action: "create" }));
    expect(manifest.operations).not.toContainEqual(expect.objectContaining({ action: "create_relationship" }));
  });

  it("does not discard a known timeline parent for a keep-unlinked decision", () => {
    const manifest = buildActOrganizeManifest({ runId: "run", sources: [
      source({ sourceRecordId: "company-1", normalized: { kind: "organization", name: "Acme", phone: null, website: null } }),
      source({
        sourceRecordId: "timeline-1",
        streamType: "activity",
        normalized: { kind: "timeline", category: "note", sourceType: "activity", body: "Known parent", subject: null, sourceOccurredAt: null, timelineSortAt: "2026-08-08T00:00:00.000Z", dateIsImportFallback: true, endsAt: null, status: null },
        relationships: { organizationSourceIds: ["company-1"] },
        reviewDecisions: [{ ...reviewDecision, decisionId: "decision-known-parent", scope: "relationship", decision: "keep_unlinked", fieldName: null }],
      }),
    ] });

    expect(manifest.outcomes.find((outcome) => outcome.sourceRecordId === "timeline-1")).toMatchObject({ state: "ready" });
    expect(manifest.operations).toContainEqual(expect.objectContaining({ sourceRecordId: "timeline-1", targetType: "activity_association", action: "create_relationship", payload: expect.objectContaining({ parentSourceRecordId: "company-1", parentType: "organization" }) }));
  });

  it("keeps valid timeline parents when only one unresolved relationship is kept unlinked", () => {
    const manifest = buildActOrganizeManifest({ runId: "run", sources: [
      source({ sourceRecordId: "company-1", normalized: { kind: "organization", name: "Acme", phone: null, website: null } }),
      source({
        sourceRecordId: "timeline-1",
        streamType: "activity",
        normalized: { kind: "timeline", category: "note", sourceType: "activity", body: "Mixed parents", subject: null, sourceOccurredAt: null, timelineSortAt: "2026-08-08T00:00:00.000Z", dateIsImportFallback: true, endsAt: null, status: null },
        relationships: { organizationSourceIds: ["company-1"] },
        reviewIssues: [{ code: "relationship_unresolved", reason: "missing_contact", relationshipSlot: "missing-contact", expectedParentTypes: ["contact"], canImportStandalone: true }],
        reviewDecisions: [{ ...reviewDecision, decisionId: "decision-missing-contact", sourceVersionId: "v-1", scope: "relationship", decision: "keep_unlinked", fieldName: null, relationshipSlot: "missing-contact", targetEntityType: null, targetEntityId: null }],
      }),
    ] });

    expect(manifest.outcomes.find((outcome) => outcome.sourceRecordId === "timeline-1")).toMatchObject({ state: "ready" });
    expect(manifest.operations).toContainEqual(expect.objectContaining({ sourceRecordId: "timeline-1", targetType: "activity_association", action: "create_relationship", payload: expect.objectContaining({ parentSourceRecordId: "company-1", parentType: "organization" }) }));
  });

  it("does not ignore a supported record from an unsupported-record decision", () => {
    const manifest = buildActOrganizeManifest({ runId: "run", sources: [source({
      reviewDecisions: [{ ...reviewDecision, decisionId: "decision-supported", scope: "unsupported_record", decision: "ignore_source", fieldName: null }],
    })] });

    expect(manifest.outcomes[0]).toMatchObject({ state: "ready" });
    expect(manifest.operations).toContainEqual(expect.objectContaining({ targetType: "organization", action: "create" }));
  });

  it("does not ignore a timeline relationship decision when a known parent is available", () => {
    const manifest = buildActOrganizeManifest({ runId: "run", sources: [
      source({ sourceRecordId: "company-1", normalized: { kind: "organization", name: "Acme", phone: null, website: null } }),
      source({
        sourceRecordId: "timeline-1",
        streamType: "activity",
        normalized: { kind: "timeline", category: "note", sourceType: "activity", body: "Known parent", subject: null, sourceOccurredAt: null, timelineSortAt: "2026-08-08T00:00:00.000Z", dateIsImportFallback: true, endsAt: null, status: null },
        relationships: { organizationSourceIds: ["company-1"] },
        reviewDecisions: [{ ...reviewDecision, decisionId: "decision-relationship-supported", scope: "relationship", decision: "ignore_source", fieldName: null }],
      }),
    ] });

    expect(manifest.outcomes.find((outcome) => outcome.sourceRecordId === "timeline-1")).toMatchObject({ state: "ready" });
    expect(manifest.operations).toContainEqual(expect.objectContaining({ sourceRecordId: "timeline-1", targetType: "activity_association", action: "create_relationship" }));
  });

  it("does not replay a decision from a stale source version", () => {
    const manifest = buildActOrganizeManifest({ runId: "run", sources: [source({
      localFields: { phone: "555-LOCAL" },
      normalized: { kind: "organization", name: "Acme", phone: "555-ACT", website: null },
      match: { kind: "exact", localId: "organization-1", reason: "exact_external_link" },
      reviewDecisions: [{ ...reviewDecision, sourceVersionId: "stale-version" }],
    })] });

    expect(manifest.outcomes[0]?.issues).toContainEqual({ code: "field_conflict", reason: "phone" });
    expect(manifest.operations).not.toContainEqual(expect.objectContaining({ action: "overwrite_reviewed" }));
  });

  it("gives generated relationship blockers stable actionable slot metadata", () => {
    const input = source({
      sourceRecordId: "contact-with-missing-company",
      sourceVersionId: "contact-version",
      streamType: "contact",
      normalized: { kind: "contact", firstName: "Ada", lastName: "Lovelace", email: null, phone: null },
      relationships: { organizationSourceIds: ["missing-company-source"] },
    });

    const first = buildActOrganizeManifest({ runId: "run", sources: [input] });
    const second = buildActOrganizeManifest({ runId: "run", sources: [input] });
    const issue = first.outcomes[0]?.issues.find((candidate) => candidate.code === "relationship_unresolved");

    expect(issue).toMatchObject({
      reason: "parent_source_not_found_or_ambiguous",
      relationshipSlot: expect.any(String),
      expectedParentTypes: ["organization"],
      canImportStandalone: true,
    });
    expect(issue?.relationshipSlot).not.toBe("");
    expect(second.outcomes[0]?.issues).toContainEqual(issue);
  });

  it("treats calendar capability as metadata for activity, note, and history timelines", () => {
    const capturedAt = "2026-08-07T12:00:00.000Z";
    const timelines = [
      ["activity", normalizeTimeline({ Details: "Calendar call", ScheduleDate: "2026-08-08T12:00:00.000Z" }, capturedAt, "activity")],
      ["note", normalizeTimeline({ Body: "Archived note", CreateDate: "2026-08-06T12:00:00.000Z" }, capturedAt, "note")],
      ["history", normalizeTimeline({ Details: "Archived history", CreateDate: "2026-08-05T12:00:00.000Z" }, capturedAt, "history")],
    ] as const;
    expect(timelines.every(([, normalized]) => normalized.ok)).toBe(true);
    const timelineSources = timelines.map(([streamType, normalized]) => ({
      sourceRecordId: streamType,
      sourceVersionId: `${streamType}-version`,
      streamType,
      normalized: normalized.ok ? normalized.value : null,
      match: { kind: "none", reason: "no_candidate" } as const,
      warnings: [],
      unsupportedFieldPaths: [],
      relationships: { organizationSourceIds: ["company"] },
    }));
    const unsupported = timelineSources[2]!;
    const result = buildActOrganizeManifest({ runId: "run", sources: [
      source({ sourceRecordId: "company", sourceVersionId: "company-version", normalized: { kind: "organization", name: "Acme", phone: null, website: null } }),
      ...timelineSources,
      { ...unsupported, sourceRecordId: "history-unsupported", sourceVersionId: "history-unsupported-version", normalized: { ...unsupported.normalized!, retentionCode: "KEEP-7" } },
    ] });

    for (const streamType of ["activity", "note", "history"]) {
      expect(result.outcomes.find((outcome) => outcome.sourceRecordId === streamType)).toMatchObject({ state: "ready", issues: [] });
      expect(result.operations).toContainEqual(expect.objectContaining({ sourceRecordId: streamType, targetType: "activity", action: "create" }));
    }
    expect(result.outcomes.find((outcome) => outcome.sourceRecordId === "history-unsupported")).toMatchObject({
      state: "ready",
      issues: [{ code: "unsupported_field", reason: "retentionCode" }],
    });
    expect(result.operations).toContainEqual(expect.objectContaining({ sourceRecordId: "history-unsupported", targetType: "activity", action: "create" }));
  });
});
