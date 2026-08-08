import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildActOrganizeManifest,
  type ManifestSourceInput,
} from "./manifest-builder";
import { normalizeTimeline } from "./normalizers/timeline-normalizer";

const source = (
  overrides: Partial<ManifestSourceInput> = {},
): ManifestSourceInput => ({
  sourceRecordId: "s-1",
  sourceVersionId: "v-1",
  streamType: "company",
  normalized: {
    kind: "organization",
    name: "Acme",
    phone: null,
    website: null,
  },
  match: { kind: "none", reason: "no_candidate" },
  warnings: [],
  unsupportedFieldPaths: [],
  ...overrides,
});

describe("buildActOrganizeManifest", () => {
  it("orders parent creation before relationships and provenance", () => {
    const result = buildActOrganizeManifest({
      runId: "run",
      sources: [
        source({
          sourceRecordId: "contact",
          sourceVersionId: "cv",
          streamType: "contact",
          normalized: {
            kind: "contact",
            firstName: "A",
            lastName: "B",
            email: null,
            phone: null,
          },
        }),
        source({
          sourceRecordId: "company",
          sourceVersionId: "ov",
          streamType: "company",
          normalized: {
            kind: "organization",
            name: "Org",
            phone: null,
            website: null,
          },
        }),
        source({
          sourceRecordId: "activity",
          sourceVersionId: "av",
          streamType: "activity",
          normalized: {
            kind: "timeline",
            category: "calendar",
            sourceType: "activity",
            body: "Call",
            subject: null,
            sourceOccurredAt: null,
            timelineSortAt: "2026-01-01T00:00:00.000Z",
            dateIsImportFallback: true,
            endsAt: null,
            status: null,
          },
          relationships: {
            organizationSourceIds: ["company"],
            contactSourceIds: ["contact"],
            bookingSourceIds: [],
          },
        }),
      ],
    });
    expect(result.operations.map((operation) => operation.targetType)).toEqual([
      "organization",
      "contact",
      "activity",
      "activity_association",
      "activity_association",
      "activity",
      "organization",
      "contact",
    ]);
    expect(result.operations[2]?.dependencyOperationKeys).toEqual([
      "contact:contact",
      "organization:company",
    ]);
    expect(
      result.operations
        .filter((operation) => operation.targetType === "activity_association")
        .map((operation) => operation.dependencyOperationKeys),
    ).toEqual([
      ["activity:activity", "organization:company"],
      ["activity:activity", "contact:contact"],
    ]);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is permutation independent and does not auto-apply ambiguous matches", () => {
    const inputs = [
      source(),
      source({
        sourceRecordId: "s-2",
        sourceVersionId: "v-2",
        match: {
          kind: "ambiguous",
          candidateIds: ["z", "a"],
          reason: "name_only",
        },
      }),
    ];
    const first = buildActOrganizeManifest({ runId: "run", sources: inputs });
    const second = buildActOrganizeManifest({
      runId: "run",
      sources: [...inputs].reverse(),
    });
    expect(second).toEqual(first);
    expect(
      first.outcomes.find((row) => row.sourceRecordId === "s-2"),
    ).toMatchObject({
      state: "awaiting_review",
      issues: [{ code: "ambiguous_match" }],
    });
    expect(
      first.operations.find((row) => row.sourceRecordId === "s-2"),
    ).toBeUndefined();
  });

  it("imports supported fields while retaining archived-only field diagnostics", () => {
    const result = buildActOrganizeManifest({
      runId: "run",
      sources: [
        source({
          warnings: ["bad field", "bad field"],
          unsupportedFieldPaths: ["secret.value"],
        }),
      ],
    });
    expect(result.diagnostics).toEqual([
      {
        code: "unsupported_field",
        sourceRecordId: "s-1",
        path: "secret.value",
      },
    ]);
    expect(result.outcomes[0]).toMatchObject({
      state: "ready",
      issues: [{ code: "unsupported_field", reason: "secret.value" }],
    });
    expect(result.operations).toContainEqual(
      expect.objectContaining({
        sourceRecordId: "s-1",
        targetType: "organization",
        action: "create",
        safeByDefault: true,
      }),
    );
    expect(result.operations).toContainEqual(
      expect.objectContaining({
        sourceRecordId: "s-1",
        targetType: "organization",
        action: "record_provenance",
        payload: expect.objectContaining({
          unsupportedFieldPaths: ["secret.value"],
        }),
      }),
    );
    expect(result.digest).toBe(
      createHash("sha256")
        .update(
          JSON.stringify({
            operations: result.operations,
            outcomes: result.outcomes,
          }),
        )
        .digest("hex"),
    );
  });

  it("emits fill operations only for supported contact fields and ignores matching metadata", () => {
    const result = buildActOrganizeManifest({
      runId: "run",
      sources: [
        source({
          streamType: "contact",
          normalized: {
            kind: "contact",
            firstName: "Jane",
            lastName: "Doe",
            email: "jane@example.com",
            emailIdentityMatchSafe: true,
            phone: null,
            jobTitle: null,
            address1: "1 Main St",
            address2: "Suite 2",
            city: "Denver",
            region: "CO",
            postalCode: "80202",
          },
          match: {
            kind: "exact",
            localId: "contact-1",
            reason: "exact_external_link",
          },
          localFields: {
            firstName: "Jane",
            lastName: "Doe",
            email: null,
            phone: null,
            jobTitle: null,
            address1: null,
            address2: null,
            city: null,
            region: null,
            postalCode: null,
          },
        }),
      ],
    });

    const fillFields = result.operations
      .filter((operation) => operation.action === "fill_missing")
      .map((operation) => operation.payload.fieldName);
    expect(fillFields).toEqual([
      "address1",
      "address2",
      "city",
      "email",
      "postalCode",
      "region",
    ]);
    expect(fillFields).not.toContain("emailIdentityMatchSafe");
    expect(result.outcomes[0]).toMatchObject({ state: "ready", issues: [] });
  });

  it("shares writable organization industry and address mappings with apply", () => {
    const result = buildActOrganizeManifest({
      runId: "run",
      sources: [
        source({
          normalized: {
            kind: "organization",
            name: "Acme",
            phone: null,
            website: null,
            industry: "Performing Arts",
            address1: null,
            address2: "Floor 3",
            city: null,
            region: null,
            postalCode: null,
          },
          match: {
            kind: "exact",
            localId: "organization-1",
            reason: "exact_external_link",
          },
          localFields: { name: "Acme", industry: null, address2: null },
        }),
      ],
    });

    expect(
      result.operations
        .filter((operation) => operation.action === "fill_missing")
        .map((operation) => operation.payload.fieldName),
    ).toEqual(["address2", "industry"]);
    expect(result.outcomes[0]).toMatchObject({ state: "ready", issues: [] });
  });

  it("holds a materially populated unsupported normalized source field for review", () => {
    const result = buildActOrganizeManifest({
      runId: "run",
      sources: [
        source({
          normalized: {
            kind: "organization",
            name: "Acme",
            phone: null,
            website: null,
            legacyOwnerCode: "OWNER-7",
          },
          match: {
            kind: "exact",
            localId: "organization-1",
            reason: "exact_external_link",
          },
          localFields: { name: "Acme" },
        }),
      ],
    });

    expect(result.outcomes[0]).toMatchObject({
      state: "awaiting_review",
      issues: [{ code: "unsupported_field", reason: "legacyOwnerCode" }],
    });
    expect(result.diagnostics).toContainEqual({
      code: "unsupported_field",
      sourceRecordId: "s-1",
      path: "legacyOwnerCode",
    });
    expect(result.operations).toEqual([]);
  });

  it("treats calendar capability as metadata for activity, note, and history timelines", () => {
    const capturedAt = "2026-08-07T12:00:00.000Z";
    const timelines = [
      [
        "activity",
        normalizeTimeline(
          {
            Details: "Calendar call",
            ScheduleDate: "2026-08-08T12:00:00.000Z",
          },
          capturedAt,
          "activity",
        ),
      ],
      [
        "note",
        normalizeTimeline(
          { Body: "Archived note", CreateDate: "2026-08-06T12:00:00.000Z" },
          capturedAt,
          "note",
        ),
      ],
      [
        "history",
        normalizeTimeline(
          {
            Details: "Archived history",
            CreateDate: "2026-08-05T12:00:00.000Z",
          },
          capturedAt,
          "history",
        ),
      ],
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
    const result = buildActOrganizeManifest({
      runId: "run",
      sources: [
        source({
          sourceRecordId: "company",
          sourceVersionId: "company-version",
          normalized: {
            kind: "organization",
            name: "Acme",
            phone: null,
            website: null,
          },
        }),
        ...timelineSources,
        {
          ...unsupported,
          sourceRecordId: "history-unsupported",
          sourceVersionId: "history-unsupported-version",
          normalized: { ...unsupported.normalized!, retentionCode: "KEEP-7" },
        },
      ],
    });

    for (const streamType of ["activity", "note", "history"]) {
      expect(
        result.outcomes.find(
          (outcome) => outcome.sourceRecordId === streamType,
        ),
      ).toMatchObject({ state: "ready", issues: [] });
      expect(result.operations).toContainEqual(
        expect.objectContaining({
          sourceRecordId: streamType,
          targetType: "activity",
          action: "create",
        }),
      );
    }
    expect(
      result.outcomes.find(
        (outcome) => outcome.sourceRecordId === "history-unsupported",
      ),
    ).toMatchObject({
      state: "awaiting_review",
      issues: [{ code: "unsupported_field", reason: "retentionCode" }],
    });
    expect(
      result.operations.some(
        (operation) => operation.sourceRecordId === "history-unsupported",
      ),
    ).toBe(false);
  });
});
