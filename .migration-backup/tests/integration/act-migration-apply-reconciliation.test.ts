import { describe, expect, it } from "vitest";

import type { MigrationApplyManifest } from "@/features/act-migration/apply-types";
import type { MigrationApplyWorkspace } from "@/features/act-migration/apply-repository";
import { reconcileMigrationApply } from "@/features/act-migration/reconciliation";

const manifest = {
  sourceDigest: "source-digest", previewProposalDigest: "preview-proposal-digest", entries: [],
  counts: {
    proposalTotal: 12, runnable: 5, reconciled: 2, ignored: 1, pending: 2, failed: 2,
    byTarget: {
      organization: { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 },
      contact: { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 },
      organization_contact: { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 },
      booking: { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 },
      booking_contact: { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 },
      calling_list: { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 },
      calling_list_member: { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 },
    },
  },
  digest: "manifest-digest",
} satisfies MigrationApplyManifest;

const workspace = {
  runId: "run-1", runStatus: "partially_applied",
  counts: { pending: 1, leased: 0, blocked: 1, applied: 2, ignored: 0, failed: 1, total: 5 },
  batches: [{
    id: "batch-1", requestKey: "request-1", runId: "run-1", requestedBy: "owner-1",
    status: "partially_applied", manifestDigest: "manifest-digest",
    summary: { pending: 1, leased: 0, blocked: 1, applied: 2, ignored: 0, failed: 1, total: 5 },
    lastErrorCode: "safe_error", startedAt: null, completedAt: null,
  }],
} satisfies MigrationApplyWorkspace;

describe("reviewed Act migration apply reconciliation", () => {
  it("accounts for every proposal while retaining only count-and-digest evidence", () => {
    const report = reconcileMigrationApply({ manifest, workspace });

    expect(report).toMatchObject({
      proposalTotal: 12, reconciled: 2, approved: 5, scheduled: 5, applied: 2,
      ignored: 1, pending: 3, blocked: 1, failed: 3, manifestDigest: "manifest-digest",
    });
    expect(report.proposalTotal).toBe(
      report.reconciled + report.applied + report.ignored +
      report.pending + report.blocked + report.failed,
    );
    expect(report.appliedResultDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces an order-independent digest from count-only workspace data", () => {
    const forward = reconcileMigrationApply({ manifest, workspace });
    const reversed = reconcileMigrationApply({
      manifest,
      workspace: { ...workspace, batches: [...workspace.batches].toReversed() },
    });

    expect(reversed.appliedResultDigest).toBe(forward.appliedResultDigest);
  });

  it("rejects an apply workspace that cannot be reconciled to approved proposals", () => {
    expect(() => reconcileMigrationApply({
      manifest,
      workspace: { ...workspace, counts: { ...workspace.counts, total: 6 } },
    })).toThrow("Act migration apply workspace counts are inconsistent.");
  });
});
