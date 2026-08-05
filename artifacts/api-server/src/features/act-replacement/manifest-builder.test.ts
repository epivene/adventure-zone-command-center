import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildActOrganizeManifest, type ManifestSourceInput } from "./manifest-builder";

const source = (overrides: Partial<ManifestSourceInput> = {}): ManifestSourceInput => ({
  sourceRecordId: "s-1", sourceVersionId: "v-1", streamType: "company",
  normalized: { kind: "organization", name: "Acme", phone: null, website: null },
  match: { kind: "none", reason: "no_candidate" }, warnings: [], unsupportedFieldPaths: [],
  ...overrides,
});

describe("buildActOrganizeManifest", () => {
  it("orders parent creation before relationships and provenance", () => {
    const result = buildActOrganizeManifest({ runId: "run", sources: [
      source({ sourceRecordId: "contact", sourceVersionId: "cv", streamType: "contact", normalized: { kind: "contact", firstName: "A", lastName: "B", email: null, phone: null } }),
      source({ sourceRecordId: "company", sourceVersionId: "ov", streamType: "company", normalized: { kind: "organization", name: "Org", phone: null, website: null } }),
      source({ sourceRecordId: "activity", sourceVersionId: "av", streamType: "activity", normalized: { kind: "timeline", category: "calendar", sourceType: "activity", body: "Call", subject: null, sourceOccurredAt: null, timelineSortAt: "2026-01-01T00:00:00.000Z", dateIsImportFallback: true, endsAt: null, status: null }, relationships: { organizationSourceIds: ["company"], contactSourceIds: ["contact"], bookingSourceIds: [] } }),
    ]});
    expect(result.operations.map((operation) => operation.targetType)).toEqual([
      "organization", "contact", "activity", "activity_association", "activity_association", "activity", "organization", "contact",
    ]);
    expect(result.operations[2]?.dependencyOperationKeys).toEqual(["contact:contact", "organization:company"]);
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

  it("keeps diagnostics safe and digest canonical", () => {
    const result = buildActOrganizeManifest({ runId: "run", sources: [source({ warnings: ["bad field", "bad field"], unsupportedFieldPaths: ["secret.value"] })] });
    expect(result.diagnostics).toEqual([{ code: "unsupported_field", sourceRecordId: "s-1", path: "secret.value" }]);
    expect(result.digest).toBe(createHash("sha256").update(JSON.stringify({ operations: result.operations, outcomes: result.outcomes })).digest("hex"));
  });
});
