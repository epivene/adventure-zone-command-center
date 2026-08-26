import { describe, expect, it, vi } from "vitest";

import { GoogleHistoricalOutcomeReconciler } from "./google-historical-outcome-reconciler";

describe("historical Gmail outcome reconciliation", () => {
  it("promotes resolved and ignored review items before rebuilding counters", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("FROM google_workspace_connections")) return { rows: [{ id: "connection-id" }] };
      if (text.includes("GROUP BY outcome")) return { rows: [
        { outcome: "attached", count: "202" },
        { outcome: "ignored", count: "50" },
        { outcome: "needs_review", count: "1" },
      ] };
      return { rows: [] };
    });
    const reconciler = new GoogleHistoricalOutcomeReconciler({ query });

    const counts = await reconciler.reconcile();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("google_workspace_validation_mappings"),
      ["connection-id"],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("review_state = 'ignored'"),
      ["connection-id"],
    );
    expect(counts).toEqual({ processed: 253, attached: 202, ignored: 50, needsReview: 1, failed: 0, skipped: 0 });
  });

  it("rebuilds cumulative counters from durable outcomes without rerunning Gmail", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("FROM google_workspace_connections")) return { rows: [{ id: "connection-id" }] };
      if (text.includes("GROUP BY outcome")) return { rows: [
        { outcome: "attached", count: "187" },
        { outcome: "ignored", count: "51" },
        { outcome: "needs_review", count: "10" },
        { outcome: "failed", count: "2" },
      ] };
      return { rows: [] };
    });
    const reconciler = new GoogleHistoricalOutcomeReconciler({ query });

    const counts = await reconciler.reconcile();

    expect(counts).toEqual({ processed: 250, attached: 187, ignored: 51, needsReview: 10, failed: 2, skipped: 0 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("processed_count = $2"), [
      "connection-id", 250, 187, 51, 10, 2, 0,
    ]);
  });
});
