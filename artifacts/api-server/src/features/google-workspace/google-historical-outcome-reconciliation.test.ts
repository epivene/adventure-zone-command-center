import { describe, expect, it, vi } from "vitest";

import { GoogleHistoricalOutcomeReconciler } from "./google-historical-outcome-reconciler";

describe("historical Gmail outcome reconciliation", () => {
  it("rebuilds cumulative counters from durable message outcomes without rerunning Gmail", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("FROM google_workspace_connections")) {
        return { rows: [{ id: "connection-id" }] };
      }
      if (text.includes("GROUP BY outcome")) {
        return {
          rows: [
            { outcome: "attached", count: "187" },
            { outcome: "ignored", count: "51" },
            { outcome: "needs_review", count: "10" },
            { outcome: "failed", count: "2" },
          ],
        };
      }
      return { rows: [] };
    });
    const reconciler = new GoogleHistoricalOutcomeReconciler({ query });

    const counts = await reconciler.reconcile();

    expect(counts).toEqual({
      processed: 250,
      attached: 187,
      ignored: 51,
      needsReview: 10,
      failed: 2,
      skipped: 0,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("processed_count = $2"),
      ["connection-id", 250, 187, 51, 10, 2, 0],
    );
  });
});
