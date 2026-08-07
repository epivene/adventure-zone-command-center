import { describe, expect, it } from "vitest";
import {
  REQUIRED_ROOTS,
  verifyActReplacementPreview,
  type PreviewAudit,
  type PreviewStatus,
} from "./verify-act-replacement-preview";

function fixture(overrides: Partial<PreviewStatus> = {}): PreviewStatus {
  const streams = REQUIRED_ROOTS.map((streamType) => ({
    streamType,
    state: "complete",
    completedCheckpoints: 1,
    totalCheckpoints: 1,
    error: null,
    responseRows: 1,
    observedIdentities: 1,
    archivedIdentities: 1,
    completeIdentities: 1,
    partialIdentities: 0,
    failedIdentities: 0,
    snapshotVersionsInserted: 1,
  }));
  return {
    runId: "run-1",
    phase: "ready_to_apply",
    previewOnly: true,
    applyEnabled: false,
    applyBatches: [],
    durableAdapters: { reviewReader: true, commandService: true, applyRepository: true },
    requiredStreams: [...REQUIRED_ROOTS],
    leaseSummary: { active: 0, expired: 0 },
    operations: [
      {
        operationKey: "organization:company-1",
        sourceVersionId: "version-1",
        targetType: "organization",
        status: "pending",
        requiredForSourceOutcome: true,
        dependencyOperationKeys: [],
        safeByDefault: true,
      },
      {
        operationKey: "organization_contact:contact-1:company-1",
        sourceVersionId: "version-2",
        targetType: "organization_contact",
        status: "already_present",
        requiredForSourceOutcome: true,
        dependencyOperationKeys: ["organization:company-1"],
        safeByDefault: true,
      },
    ],
    streams,
    allStreams: {
      responseRows: 7,
      observedIdentities: 7,
      archivedIdentities: 7,
      completeIdentities: 7,
      partialIdentities: 0,
      failedIdentities: 0,
      snapshotVersionsInserted: 7,
      unsupportedCapabilities: 0,
    },
    ...overrides,
  };
}

const audit: PreviewAudit = {
  auditId: "audit-1",
  method: "GET",
  state: "succeeded",
  httpStatus: 200,
  pathTemplate: "/companies",
};

describe("Act preview verifier", () => {
  it("passes a complete preview with Contacts", () => {
    expect(verifyActReplacementPreview(fixture(), [audit], "pre_apply")).toEqual({
      ok: true,
      errors: [],
    });
    const completed = fixture({ phase: "complete", applyBatches: [{ state: "complete" }] });
    completed.operations = completed.operations?.map((operation) => ({ ...operation, status: "applied" }));
    expect(verifyActReplacementPreview(completed, [audit], "post_apply")).toEqual({ ok: true, errors: [] });
  });

  it("distinguishes pre-apply readiness from post-apply completion", () => {
    expect(verifyActReplacementPreview(fixture(), [audit], "post_apply").errors).toContain(
      "post-apply run is not complete",
    );
    const completedWithPending = fixture({ phase: "complete" });
    expect(verifyActReplacementPreview(completedWithPending, [audit], "post_apply").errors).toContain(
      "required operation is not terminal",
    );
  });

  it("permits a dependency-closed pending relationship before apply", () => {
    const result = verifyActReplacementPreview(fixture({
      operations: [
        { operationKey: "organization:company-1", sourceVersionId: "version-1", targetType: "organization", status: "pending", requiredForSourceOutcome: true, dependencyOperationKeys: [], safeByDefault: true },
        { operationKey: "organization_contact:contact-1:company-1", sourceVersionId: "version-2", targetType: "organization_contact", status: "pending", requiredForSourceOutcome: true, dependencyOperationKeys: ["organization:company-1"], safeByDefault: true },
      ],
    }), [audit], "pre_apply");

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("fails closed when organization is nonterminal or gate evidence is absent", () => {
    const result = verifyActReplacementPreview(
      fixture({
        phase: "organizing",
        requiredStreams: undefined,
        leaseSummary: undefined,
        operations: undefined,
        applyEnabled: undefined,
      }),
      [audit],
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        "pre-apply run is not ready",
        "required stream inventory is unavailable",
        "lease evidence is unavailable",
        "operation evidence is unavailable",
        "production apply setting is unavailable",
      ]),
    );
  });

  it("rejects unreconciled required streams and active or expired leases", () => {
    const base = fixture();
    const result = verifyActReplacementPreview(
      {
        ...base,
        streams: base.streams.filter(
          (stream) => stream.streamType !== "history",
        ),
        leaseSummary: { active: 1, expired: 2 },
      },
      [audit],
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        "required root history is missing",
        "active leases remain",
        "expired leases remain",
      ]),
    );
  });

  it("rejects partial or failed identities in every required stream", () => {
    const base = fixture();
    const result = verifyActReplacementPreview(
      {
        ...base,
        streams: base.streams.map((stream) =>
          stream.streamType === "company"
            ? { ...stream, completeIdentities: 0, partialIdentities: 1 }
            : stream.streamType === "contact"
              ? { ...stream, completeIdentities: 0, failedIdentities: 1 }
              : stream,
        ),
      },
      [audit],
      "pre_apply",
    );

    expect(result.errors).toEqual(expect.arrayContaining([
      "required root company has partial identities",
      "required root contact has failed identities",
    ]));
  });

  it("rejects applied operations without versions and unresolved required relationships", () => {
    const result = verifyActReplacementPreview(
      fixture({
        operations: [
          {
            operationKey: "contact:contact-1",
            sourceVersionId: "",
            targetType: "contact",
            status: "applied",
            requiredForSourceOutcome: true,
            dependencyOperationKeys: [],
            safeByDefault: true,
          },
          {
            operationKey: "organization_contact:contact-1:company-1",
            sourceVersionId: "version-2",
            targetType: "organization_contact",
            status: "pending",
            requiredForSourceOutcome: true,
            dependencyOperationKeys: ["missing-operation"],
            safeByDefault: true,
          },
        ],
      }),
      [audit],
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        "applied operation is missing a source version",
        "required relationship operation is unresolved",
      ]),
    );
  });

  it("accepts a required relationship explicitly held for review", () => {
    expect(
      verifyActReplacementPreview(
        fixture({
          operations: [
            {
              operationKey: "organization_contact:contact-1:company-1",
              sourceVersionId: "version-2",
              targetType: "organization_contact",
              status: "pending",
              requiredForSourceOutcome: true,
              heldForReview: true,
            },
          ],
        }),
        [audit],
      ),
    ).toEqual({ ok: true, errors: [] });
  });

  it("rejects failed required roots and non-preview runs", () => {
    const base = fixture();
    expect(
      verifyActReplacementPreview(
        {
          ...base,
          previewOnly: false,
          streams: base.streams.map((stream) =>
            stream.streamType === "contact"
              ? { ...stream, state: "failed" }
              : stream,
          ),
        },
        [audit],
      ).errors,
    ).toEqual(
      expect.arrayContaining([
        "run is not preview-only",
        "required root contact is not complete",
      ]),
    );
  });

  it("rejects bad equations, zero Contacts, and non-GET audits", () => {
    const base = fixture();
    const contact = base.streams.find(
      (stream) => stream.streamType === "contact",
    )!;
    const result = verifyActReplacementPreview(
      {
        ...base,
        streams: base.streams.map((stream) =>
          stream.streamType === "contact"
            ? { ...contact, completeIdentities: 0, snapshotVersionsInserted: 0 }
            : stream,
        ),
      },
      [{ ...audit, method: "POST" }],
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "contact completeness does not partition observations",
        "audit contains a non-GET method",
      ]),
    );

    const zeroContact = {
      ...base,
      streams: base.streams.map((stream) =>
        stream.streamType === "contact"
          ? {
              ...stream,
              observedIdentities: 0,
              archivedIdentities: 0,
              completeIdentities: 0,
              snapshotVersionsInserted: 0,
            }
          : stream,
      ),
    };
    expect(verifyActReplacementPreview(zeroContact, [audit]).errors).toContain(
      "contact count is zero",
    );
  });

  it("accepts a restart/rerun whose observations reuse existing versions", () => {
    const base = fixture();
    expect(
      verifyActReplacementPreview(
        {
          ...base,
          streams: base.streams.map((stream) => ({
            ...stream,
            snapshotVersionsInserted: 0,
          })),
          allStreams: { ...base.allStreams, snapshotVersionsInserted: 0 },
        },
        [audit],
      ),
    ).toEqual({ ok: true, errors: [] });
  });

  it("rejects active apply batches or incomplete durable adapters", () => {
    const base = fixture();
    const result = verifyActReplacementPreview(
      {
        ...base,
        applyEnabled: true,
        applyBatches: [{ state: "applying" }],
        durableAdapters: {
          reviewReader: true,
          commandService: false,
          applyRepository: true,
        },
      },
      [audit],
    );
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "production apply is enabled",
        "active apply batch remains",
        "durable review/apply adapters are unavailable",
      ]),
    );
  });

  it("requires durable adapter evidence and reconciles optional stream counters", () => {
    const base = fixture();
    const optional = { ...base.streams[0]!, streamType: "company_contact", observedIdentities: 1, archivedIdentities: 0 };
    const result = verifyActReplacementPreview({
      ...base,
      durableAdapters: undefined,
      streams: [...base.streams, optional],
    }, [audit]);

    expect(result.errors).toEqual(expect.arrayContaining([
      "durable review/apply adapter evidence is unavailable",
      "company_contact observed identities do not equal archived identities",
    ]));
  });

  it("requires batch evidence and rejects every non-allowed batch state", () => {
    expect(
      verifyActReplacementPreview(
        fixture({ applyBatches: undefined }),
        [audit],
      ).errors,
    ).toContain("apply batch evidence is unavailable");

    for (const state of ["unknown", "failed", "queued", "applying"]) {
      expect(
        verifyActReplacementPreview(
          fixture({ applyBatches: [{ state }] }),
          [audit],
        ).errors,
      ).toContain("apply batch is not terminal");
    }

    for (const state of ["complete", "complete_with_issues"]) {
      expect(
        verifyActReplacementPreview(
          fixture({ applyBatches: [{ state }] }),
          [audit],
        ).errors,
      ).not.toContain("apply batch is not terminal");
    }
  });

  it("requires baseline roots in addition to the advertised inventory", () => {
    const base = fixture();
    const result = verifyActReplacementPreview(
      {
        ...base,
        requiredStreams: ["contact"],
        streams: base.streams.filter(
          (stream) => stream.streamType !== "company",
        ),
      },
      [audit],
    );

    expect(result.errors).toContain("required root company is missing");
  });

  it("checks an advertised required relationship stream, not just root defaults", () => {
    const base = fixture();
    const relationship = {
      ...base.streams[0]!,
      streamType: "company_contact",
      state: "failed",
      error: { code: "unavailable" },
    };
    const result = verifyActReplacementPreview(
      {
        ...base,
        requiredStreams: [...REQUIRED_ROOTS, "company_contact"],
        streams: [...base.streams, relationship],
      },
      [audit],
      "pre_apply",
    );
    expect(result.errors).toContain("required root company_contact is not complete");
  });

  it("rejects audit paths that could expose credentials or raw payloads", () => {
    const result = verifyActReplacementPreview(fixture(), [
      { ...audit, pathTemplate: "/source-records/raw-token" },
    ]);
    expect(result.errors).toContain("audit contains a sensitive path");
  });
});
