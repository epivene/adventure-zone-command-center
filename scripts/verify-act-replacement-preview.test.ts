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
    phase: "extract_complete",
    previewOnly: true,
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
    expect(verifyActReplacementPreview(fixture(), [audit])).toEqual({ ok: true, errors: [] });
    expect(verifyActReplacementPreview(fixture({ phase: "complete" }), [audit])).toEqual({ ok: true, errors: [] });
  });

  it("rejects failed required roots and non-preview runs", () => {
    const base = fixture();
    expect(
      verifyActReplacementPreview(
        {
          ...base,
          previewOnly: false,
          streams: base.streams.map((stream) =>
            stream.streamType === "contact" ? { ...stream, state: "failed" } : stream,
          ),
        },
        [audit],
      ).errors,
    ).toEqual(expect.arrayContaining(["run is not preview-only", "required root contact is not complete"]));
  });

  it("rejects bad equations, zero Contacts, and non-GET audits", () => {
    const base = fixture();
    const contact = base.streams.find((stream) => stream.streamType === "contact")!;
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
    expect(result.errors).toEqual(expect.arrayContaining([
      "contact completeness does not partition observations",
      "audit contains a non-GET method",
    ]));

    const zeroContact = {
      ...base,
      streams: base.streams.map((stream) =>
        stream.streamType === "contact"
          ? { ...stream, observedIdentities: 0, archivedIdentities: 0, completeIdentities: 0, snapshotVersionsInserted: 0 }
          : stream,
      ),
    };
    expect(verifyActReplacementPreview(zeroContact, [audit]).errors).toContain("contact count is zero");
  });

  it("accepts a restart/rerun whose observations reuse existing versions", () => {
    const base = fixture();
    expect(
      verifyActReplacementPreview(
        {
          ...base,
          streams: base.streams.map((stream) => ({ ...stream, snapshotVersionsInserted: 0 })),
          allStreams: { ...base.allStreams, snapshotVersionsInserted: 0 },
        },
        [audit],
      ),
    ).toEqual({ ok: true, errors: [] });
  });

  it("rejects apply batches or incomplete durable adapters in a production preview", () => {
    const base = fixture();
    const result = verifyActReplacementPreview({
      ...base,
      applyEnabled: true,
      applyBatches: [{ state: "complete" }],
      durableAdapters: { reviewReader: true, commandService: false, applyRepository: true },
    }, [audit]);
    expect(result.errors).toEqual(expect.arrayContaining([
      "production apply is enabled",
      "production apply batches must be empty",
      "durable review/apply adapters are unavailable",
    ]));
  });

  it("rejects audit paths that could expose credentials or raw payloads", () => {
    const result = verifyActReplacementPreview(fixture(), [{ ...audit, pathTemplate: "/source-records/raw-token" }]);
    expect(result.errors).toContain("audit contains a sensitive path");
  });
});
