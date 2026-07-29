import { describe, expect, it } from "vitest";

import {
  buildStoredSyncPreview,
  deriveSyncRunStatus,
  operationClaimDisposition,
  parseStoredSyncRows,
  staleOperationRecovery,
} from "@/features/act-sync/sync-repository";

const snapshot = {
  firstName: "Avery",
  lastName: "Example",
  organizationName: "Marias Fair",
  jobTitle: null,
  email: "avery@example.com",
  phone: "406-555-0101",
  address1: null,
  address2: null,
  city: "Shelby",
  region: "MT",
  postalCode: null,
};

const row = {
  rowId: "act:act-1",
  category: "new_in_act",
  matchReason: "none",
  localContactId: null,
  actRecordId: "act-1",
  candidateLocalContactIds: [],
  candidateActRecordIds: ["act-1"],
  baseSnapshot: null,
  localSnapshot: null,
  actSnapshot: snapshot,
  actEditedAt: "2026-07-27T12:00:00.000Z",
  allowedDecisions: ["pull", "skip"],
  messages: [],
};

const counts = {
  new_in_act: 1,
  new_in_app: 0,
  changed_in_act: 0,
  changed_in_app: 0,
  changed_in_both: 0,
  possible_match: 0,
  already_matched: 0,
  missing_from_act: 0,
  error: 0,
};

describe("stored Act sync previews", () => {
  it("rejects malformed or identity-bearing stored snapshots", () => {
    expect(() =>
      parseStoredSyncRows([
        {
          ...row,
          actSnapshot: { ...snapshot, phone: 123 },
        },
      ]),
    ).toThrow("Stored Act! sync preview is malformed.");

    expect(() =>
      parseStoredSyncRows([
        {
          ...row,
          actSnapshot: {
            ...snapshot,
            id: "spoofed-act-id",
            editedAt: "2099-01-01T00:00:00.000Z",
          },
        },
      ]),
    ).toThrow("Stored Act! sync preview is malformed.");
  });

  it("hydrates durable operation state for every preview row", () => {
    const preview = buildStoredSyncPreview(
      {
        id: "run-1",
        status: "partial",
        summary: { counts, rows: [row] },
        activeQueueToken: null,
        startedAt: new Date("2026-07-27T12:00:00.000Z"),
        completedAt: null,
      },
      [
        {
          rowKey: "act:act-1",
          status: "failed",
          decision: "pull",
          localContactId: null,
          actRecordId: "act-1",
          error: "Try this contact again.",
          retryable: true,
          updatedAt: new Date("2026-07-27T12:05:00.000Z"),
        },
      ],
    );

    expect(preview.operations).toEqual([
      {
        rowId: "act:act-1",
        status: "failed",
        decision: "pull",
        localContactId: null,
        actRecordId: "act-1",
        error: "Try this contact again.",
        retryable: true,
        updatedAt: new Date("2026-07-27T12:05:00.000Z"),
      },
    ]);
  });

  it("rejects a preview whose durable operation rows do not match its rows", () => {
    expect(() =>
      buildStoredSyncPreview(
        {
          id: "run-1",
          status: "previewed",
          summary: { counts, rows: [row] },
          activeQueueToken: null,
          startedAt: new Date("2026-07-27T12:00:00.000Z"),
          completedAt: null,
        },
        [],
      ),
    ).toThrow("Stored Act! sync operations are malformed.");
  });
});

describe("Act sync operation lifecycle", () => {
  it("marks a category-only apply partial when untouched rows remain", () => {
    expect(
      deriveSyncRunStatus([
        { status: "completed" },
        { status: "pending" },
      ]),
    ).toBe("partial");
    expect(
      deriveSyncRunStatus([
        { status: "failed" },
        { status: "pending" },
      ]),
    ).toBe("partial");
  });

  it("keeps active runs applying and settles exhausted runs", () => {
    expect(
      deriveSyncRunStatus([
        { status: "completed" },
        { status: "applying" },
      ]),
    ).toBe("applying");
    expect(
      deriveSyncRunStatus([
        { status: "completed" },
        { status: "skipped" },
      ]),
    ).toBe("completed");
    expect(
      deriveSyncRunStatus([
        { status: "completed" },
        { status: "failed" },
      ]),
    ).toBe("failed");
    expect(
      deriveSyncRunStatus([
        { status: "approved" },
        { status: "pending" },
      ]),
    ).toBe("previewed");
  });

  it("recovers only stale applying work with a known safe identity", () => {
    const now = new Date("2026-07-27T13:10:00.000Z");

    expect(
      operationClaimDisposition(
        {
          status: "applying",
          decision: "pull",
          actRecordId: "act-1",
          retryable: true,
          updatedAt: new Date("2026-07-27T13:09:00.000Z"),
        },
        now,
      ),
    ).toBe("in_progress");
    expect(
      operationClaimDisposition(
        {
          status: "applying",
          decision: "pull",
          actRecordId: "act-1",
          retryable: true,
          updatedAt: new Date("2026-07-27T13:00:00.000Z"),
        },
        now,
      ),
    ).toBe("reclaim");
  });

  it("blocks an ambiguous stale remote create instead of creating a duplicate", () => {
    expect(
      operationClaimDisposition(
        {
          status: "applying",
          decision: "push",
          actRecordId: null,
          retryable: true,
          updatedAt: new Date("2026-07-27T13:00:00.000Z"),
        },
        new Date("2026-07-27T13:10:00.000Z"),
      ),
    ).toBe("manual_review");
  });

  it("reconciles stale leases into reload-safe operation states", () => {
    const now = new Date("2026-07-27T13:10:00.000Z");

    expect(
      staleOperationRecovery(
        {
          status: "applying",
          decision: "pull",
          actRecordId: "act-1",
          retryable: true,
          updatedAt: new Date("2026-07-27T13:00:00.000Z"),
        },
        now,
      ),
    ).toEqual({
      error: "A previous sync attempt was interrupted. Retry this contact.",
      retryable: true,
      status: "failed",
    });
    expect(
      staleOperationRecovery(
        {
          status: "applying",
          decision: "push",
          actRecordId: null,
          retryable: true,
          updatedAt: new Date("2026-07-27T13:00:00.000Z"),
        },
        now,
      ),
    ).toEqual({
      error:
        "A previous Act! create may have completed. Create a new preview before trying again.",
      retryable: false,
      status: "failed",
    });
    expect(
      staleOperationRecovery(
        {
          status: "applying",
          decision: "pull",
          actRecordId: "act-1",
          retryable: true,
          updatedAt: new Date("2026-07-27T13:09:00.000Z"),
        },
        now,
      ),
    ).toBeNull();
  });
});
