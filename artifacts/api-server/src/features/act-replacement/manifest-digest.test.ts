import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildActOrganizeManifest, buildLegacyActOrganizeManifest } from "./manifest-builder";
import { digestLegacyManifestRows, digestManifestRows } from "./manifest-digest";
import { manifestFromRows, verifyProtectedManifestDigest } from "./review-sql-adapter";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("digestManifestRows", () => {
  it("hashes a hand-checked recursively canonical JSON representation", () => {
    const operations = [
      {
        operationKey: "organization:source-1",
        payload: { normalized: { kind: "organization", name: "Adventure Zone" } },
        dependencyOperationKeys: [],
      },
      {
        operationKey: "activity:source-2",
        payload: { normalized: { kind: "timeline", body: "Booked \u2603" } },
        dependencyOperationKeys: ["organization:source-1"],
      },
    ];
    const outcomes = [
      { sourceRecordId: "source-1", state: "ready", operationKeys: ["organization:source-1"] },
      { sourceRecordId: "source-2", state: "ready", operationKeys: ["activity:source-2"] },
    ];
    const canonical = '{"operations":[{"dependencyOperationKeys":[],"operationKey":"organization:source-1","payload":{"normalized":{"kind":"organization","name":"Adventure Zone"}}},{"dependencyOperationKeys":["organization:source-1"],"operationKey":"activity:source-2","payload":{"normalized":{"body":"Booked ☃","kind":"timeline"}}}],"outcomes":[{"operationKeys":["organization:source-1"],"sourceRecordId":"source-1","state":"ready"},{"operationKeys":["activity:source-2"],"sourceRecordId":"source-2","state":"ready"}]}';
    const expected = createHash("sha256").update(canonical).digest("hex");

    expect(digestManifestRows(operations, outcomes)).toBe(expected);
  });

  it("never stringifies the complete manifest arrays", () => {
    const operations = Array.from({ length: 16_252 }, (_, index) => ({
      operationKey: `activity:source-${index}`,
      payload: { normalized: { kind: "timeline", body: "x".repeat(256) } },
    }));
    const outcomes = operations.map((operation, index) => ({
      sourceRecordId: `source-${index}`,
      state: "ready",
      operationKeys: [operation.operationKey],
    }));
    const originalStringify = JSON.stringify.bind(JSON);
    vi.spyOn(JSON, "stringify").mockImplementation((value: unknown) => {
      expect(value).not.toBe(operations);
      expect(value).not.toBe(outcomes);
      return originalStringify(value);
    });

    expect(digestManifestRows(operations, outcomes)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("survives deep PostgreSQL jsonb object-key reordering at both production call sites", () => {
    const deepReverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(deepReverseKeys);
      if (!value || typeof value !== "object") return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .reverse()
          .map(([key, nested]) => [key, deepReverseKeys(nested)]),
      );
    };
    const organized = buildActOrganizeManifest({
      runId: "jsonb-order-run",
      sources: [{
        sourceRecordId: "source-1",
        sourceVersionId: "version-1",
        streamType: "company",
        normalized: {
          kind: "organization",
          name: "Adventure Zone",
          phone: "555-0100",
          address1: "1 Story Lane",
          city: "Chicago",
          region: "IL",
        },
        match: {
          kind: "exact",
          localId: "local-1",
          reason: "reliable_identity",
          evidence: [{
            family: "direct_contact",
            label: "nested evidence",
            targetEntityType: "organization",
            targetEntityId: "local-1",
            authority: "authoritative",
          }],
        },
        provenance: ["archive", "detail"],
      }],
    });
    const dbOperations = organized.operations.map((row) => deepReverseKeys(row) as Record<string, unknown>);
    const dbOutcomes = organized.outcomes.map((row) => deepReverseKeys(row) as Record<string, unknown>);

    expect(digestManifestRows(dbOperations, dbOutcomes)).toBe(organized.digest);
    expect(manifestFromRows({ operations: dbOperations, outcomes: dbOutcomes }).digest).toBe(organized.digest);
  });

  it("fails closed for values PostgreSQL jsonb cannot round-trip", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const malformed of [
      { bad: undefined },
      { bad: Number.NaN },
      { bad: Number.POSITIVE_INFINITY },
      { bad: 1n },
      { bad: new Date("2026-08-12T00:00:00.000Z") },
      cyclic,
    ]) {
      expect(() => digestManifestRows([{ operationKey: "bad", payload: malformed }], []))
        .toThrow("manifest_digest_unsupported_value");
    }
  });

  it("rejects malformed durable JSONB fields instead of normalizing them before hashing", () => {
    const operation = {
      operationKey: "organization:source-1",
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      targetType: "organization",
      action: "create",
      payload: { normalized: { kind: "organization", name: "Adventure Zone" } },
      dependencyOperationKeys: [],
      requiredForSourceOutcome: true,
      safeByDefault: true,
    };
    const outcome = {
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      state: "ready",
      issues: [],
      candidates: [],
      match: null,
      mappingWarnings: [],
      unsupportedFieldPaths: [],
    };

    for (const rows of [
      { operations: [{ ...operation, payload: "not-an-object" }], outcomes: [outcome] },
      { operations: [{ ...operation, dependencyOperationKeys: {} }], outcomes: [outcome] },
      { operations: [operation], outcomes: [{ ...outcome, issues: "not-an-array" }] },
      { operations: [operation], outcomes: [{ ...outcome, match: [] }] },
    ]) {
      expect(() => manifestFromRows(rows as never)).toThrow("manifest_row_invalid");
    }
  });

  it.each([
    ["non-string dependency operation keys", (operation: Record<string, unknown>, outcome: Record<string, unknown>) => ({
      operations: [{ ...operation, dependencyOperationKeys: [1] }], outcomes: [outcome],
    })],
    ["non-string mapping warnings", (operation: Record<string, unknown>, outcome: Record<string, unknown>) => ({
      operations: [operation], outcomes: [{ ...outcome, mappingWarnings: [false] }],
    })],
    ["non-string issue codes", (operation: Record<string, unknown>, outcome: Record<string, unknown>) => ({
      operations: [operation], outcomes: [{ ...outcome, issues: [{ code: 1 }] }],
    })],
    ["null issues", (operation: Record<string, unknown>, outcome: Record<string, unknown>) => ({
      operations: [operation], outcomes: [{ ...outcome, issues: [null] }],
    })],
    ["null candidates", (operation: Record<string, unknown>, outcome: Record<string, unknown>) => ({
      operations: [operation], outcomes: [{ ...outcome, candidates: [null] }],
    })],
  ])("rejects %s as manifest_row_invalid", (_label, malformedRows) => {
    const operation = {
      operationKey: "organization:source-1",
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      targetType: "organization",
      action: "create",
      payload: { normalized: { kind: "organization", name: "Adventure Zone" } },
      dependencyOperationKeys: [],
      requiredForSourceOutcome: true,
      safeByDefault: true,
    };
    const outcome = {
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      state: "ready",
      issues: [],
      candidates: [],
      match: null,
      mappingWarnings: [],
      unsupportedFieldPaths: [],
    };

    expect(() => manifestFromRows(malformedRows(operation, outcome) as never))
      .toThrow("manifest_row_invalid");
  });

  it("reconstructs multi-operation outcome keys in the builder's canonical source-filtered order", () => {
    const organized = buildActOrganizeManifest({
      runId: "multi-operation-recovery",
      sources: [{
        sourceRecordId: "source-1",
        sourceVersionId: "version-1",
        streamType: "company",
        normalized: { kind: "organization", name: "Adventure Zone", phone: "555-0100", website: "https://example.com" },
        match: { kind: "exact", localId: "local-1", reason: "reliable_identity" },
        localFields: { name: "Adventure Zone", phone: null, website: null },
      }],
    });
    const durable = manifestFromRows({
      operations: JSON.parse(JSON.stringify([...organized.operations].reverse())),
      outcomes: JSON.parse(JSON.stringify(organized.outcomes.map(({ operationKeys: _operationKeys, ...outcome }) => outcome))),
    });

    expect(durable.outcomes[0]?.operationKeys).toEqual(organized.outcomes[0]?.operationKeys);
    expect(durable.digest).toBe(organized.digest);
  });

  it("accepts a legacy insertion-order digest only when protected and durable manifests agree", () => {
    const protectedManifest = buildActOrganizeManifest({
      runId: "legacy-run",
      sources: [{
        sourceRecordId: "source-1",
        sourceVersionId: "version-1",
        streamType: "company",
        normalized: { kind: "organization", name: "Adventure Zone", phone: "555-0100" },
        match: { kind: "none", reason: "no_candidate" },
      }],
    });
    const legacyDigest = digestLegacyManifestRows(
      protectedManifest.operations,
      protectedManifest.outcomes,
    );
    const durableManifest = manifestFromRows({
      operations: JSON.parse(JSON.stringify(protectedManifest.operations)),
      outcomes: JSON.parse(JSON.stringify(protectedManifest.outcomes)),
    });

    expect(legacyDigest).not.toBe(protectedManifest.digest);
    expect(verifyProtectedManifestDigest({
      storedDigest: legacyDigest,
      digestVersion: null,
      durableManifest,
      protectedManifest,
      protectedLegacyManifest: { ...protectedManifest, digest: legacyDigest },
    })).toBe(protectedManifest.digest);
    expect(() => verifyProtectedManifestDigest({
      storedDigest: "f".repeat(64),
      digestVersion: null,
      durableManifest,
      protectedManifest,
      protectedLegacyManifest: { ...protectedManifest, digest: legacyDigest },
    })).toThrow("manifest_digest_mismatch");
    expect(() => verifyProtectedManifestDigest({
      storedDigest: legacyDigest,
      digestVersion: null,
      durableManifest: { ...durableManifest, digest: "e".repeat(64) },
      protectedManifest,
      protectedLegacyManifest: { ...protectedManifest, digest: legacyDigest },
    })).toThrow("manifest_digest_mismatch");
  });

  it("verifies the historical per-source insertion order for a multi-operation legacy manifest", () => {
    const sources = [{
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      streamType: "company",
      normalized: {
        kind: "organization", name: "Adventure Zone",
        website: "https://example.com", phone: "555-0100",
      },
      match: { kind: "exact" as const, localId: "local-1", reason: "manual_review" },
      localFields: { name: "Adventure Zone", website: null, phone: null },
    }];
    const protectedManifest = buildActOrganizeManifest({ runId: "legacy-run", sources });
    const protectedLegacyManifest = buildLegacyActOrganizeManifest({ runId: "legacy-run", sources });
    const legacyDigest = protectedLegacyManifest.digest;

    expect(protectedLegacyManifest.operations).toEqual(protectedManifest.operations);
    expect(protectedLegacyManifest.outcomes[0]?.operationKeys).not.toEqual(
      protectedManifest.outcomes[0]?.operationKeys,
    );
    expect(verifyProtectedManifestDigest({
      storedDigest: legacyDigest,
      digestVersion: null,
      durableManifest: protectedManifest,
      protectedManifest,
      protectedLegacyManifest,
    })).toBe(protectedManifest.digest);
    expect(() => verifyProtectedManifestDigest({
      storedDigest: legacyDigest,
      digestVersion: null,
      durableManifest: protectedManifest,
      protectedManifest,
      protectedLegacyManifest: {
        ...protectedLegacyManifest,
        outcomes: protectedLegacyManifest.outcomes.map((outcome) => ({ ...outcome, state: "ignored" as const })),
      },
    })).toThrow("manifest_digest_mismatch");
  });

  it("keeps both production digest call sites on bounded serialization", () => {
    const originalStringify = JSON.stringify.bind(JSON);
    vi.spyOn(JSON, "stringify").mockImplementation((value: unknown) => {
      if (
        value &&
        typeof value === "object" &&
        "operations" in value &&
        "outcomes" in value
      ) {
        throw new Error("whole_manifest_serialization");
      }
      return originalStringify(value);
    });
    const organized = buildActOrganizeManifest({
      runId: "run-1",
      sources: [
        {
          sourceRecordId: "source-1",
          sourceVersionId: "version-1",
          streamType: "company",
          normalized: { kind: "organization", name: "Adventure Zone" },
          match: { kind: "none", reason: "no_candidate" },
        },
      ],
    });

    expect(organized.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      manifestFromRows({
        operations: organized.operations,
        outcomes: organized.outcomes,
      }).digest,
    ).toBe(organized.digest);
  });
});
