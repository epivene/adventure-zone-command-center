import { describe, expect, it, vi } from "vitest";

import { GoogleValidationReviewReconciler } from "./google-validation-review-reconciler";

function fakePool() {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    queries.push({ text, values });
    if (text.includes("FROM google_workspace_connections")) {
      return { rows: [{ id: "connection-id" }] };
    }
    return { rows: [] };
  });
  return { query, queries };
}

describe("Google validation review reconciliation", () => {
  it("removes stale pending review rows for sample messages that no longer need review", async () => {
    const pool = fakePool();
    const reconciler = new GoogleValidationReviewReconciler(pool);

    await reconciler.reconcile({
      sampleMessageIds: ["matched-now", "still-review", "ignored-now"],
      pendingMessageIds: ["still-review"],
    });

    const cleanup = pool.queries.find(({ text }) =>
      text.includes("DELETE FROM google_workspace_validation_review_items"),
    );
    expect(cleanup?.values).toEqual([
      "connection-id",
      ["matched-now", "still-review", "ignored-now"],
      ["still-review"],
    ]);
    expect(cleanup?.text).toContain("review_state = 'pending'");
  });

  it("does not delete resolved or ignored manual decisions", async () => {
    const pool = fakePool();
    const reconciler = new GoogleValidationReviewReconciler(pool);

    await reconciler.reconcile({
      sampleMessageIds: ["manual-resolved", "manual-ignored"],
      pendingMessageIds: [],
    });

    const cleanup = pool.queries.find(({ text }) =>
      text.includes("DELETE FROM google_workspace_validation_review_items"),
    );
    expect(cleanup?.text).toContain("review_state = 'pending'");
  });
});
