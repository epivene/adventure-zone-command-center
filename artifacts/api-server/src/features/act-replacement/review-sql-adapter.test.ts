import { describe, expect, it } from "vitest";
import { manifestFromRows } from "./review-sql-adapter";

describe("durable review adapter projections", () => {
  it("reconstructs the canonical manifest digest from persisted rows", () => {
    const manifest = manifestFromRows({
      operations: [{ operationKey: "organization:a", sourceRecordId: "a", sourceVersionId: "v1", targetType: "organization", action: "create", payload: { normalized: { kind: "organization", name: "A" } }, dependencyOperationKeys: [], requiredForSourceOutcome: true, safeByDefault: true }],
      outcomes: [{ sourceRecordId: "a", sourceVersionId: "v1", state: "ready", issues: [], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: ["organization:a"] }],
    });
    expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.operations[0]?.payload).toEqual({ normalized: { kind: "organization", name: "A" } });
    expect(manifest.outcomes[0]?.state).toBe("ready");
  });

  it("sorts persisted rows before hashing so SQL result order cannot change approvals", () => {
    const rows = { operations: [{ operationKey: "z", sourceRecordId: "z", sourceVersionId: "vz", targetType: "organization", action: "create", payload: {}, dependencyOperationKeys: [], requiredForSourceOutcome: true, safeByDefault: true }, { operationKey: "a", sourceRecordId: "a", sourceVersionId: "va", targetType: "organization", action: "create", payload: {}, dependencyOperationKeys: [], requiredForSourceOutcome: true, safeByDefault: true }], outcomes: [{ sourceRecordId: "z", sourceVersionId: "vz", state: "ready", issues: [], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: ["z"] }, { sourceRecordId: "a", sourceVersionId: "va", state: "ready", issues: [], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: ["a"] }] };
    const reversed = manifestFromRows({ operations: [...rows.operations].reverse(), outcomes: [...rows.outcomes].reverse() });
    expect(manifestFromRows(rows).digest).toBe(reversed.digest);
  });
});
