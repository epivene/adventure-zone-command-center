import { describe, expect, it } from "vitest";

import {
  decisionsForCategory,
  safeDecisionForCategory,
} from "@/features/act-sync/category-approval";
import type { SyncComparisonRow } from "@/features/act-sync/sync-comparison";

function row(
  rowId: string,
  category: SyncComparisonRow["category"],
  allowedDecisions: SyncComparisonRow["allowedDecisions"],
): SyncComparisonRow {
  return {
    rowId,
    category,
    matchReason: "none",
    localContactId: null,
    actRecordId: `act-${rowId}`,
    candidateLocalContactIds: [],
    candidateActRecordIds: [`act-${rowId}`],
    baseSnapshot: null,
    localSnapshot: null,
    actSnapshot: null,
    actEditedAt: null,
    allowedDecisions,
    messages: [],
  };
}

describe("Act sync category approval", () => {
  it("returns decisions only for the selected safe category", () => {
    const rows = [
      row("act-1", "new_in_act", ["pull", "skip"]),
      row("act-2", "new_in_act", ["pull", "skip"]),
      row("app-1", "new_in_app", ["push", "skip"]),
    ];

    expect(decisionsForCategory(rows, "new_in_act")).toEqual([
      { rowId: "act-1", decision: "pull" },
      { rowId: "act-2", decision: "pull" },
    ]);
  });

  it("does not bulk-approve conflicts or possible matches", () => {
    expect(safeDecisionForCategory("changed_in_both")).toBeUndefined();
    expect(safeDecisionForCategory("possible_match")).toBeUndefined();
    expect(
      decisionsForCategory(
        [row("conflict", "changed_in_both", ["keep_act", "keep_app", "skip"])],
        "changed_in_both",
      ),
    ).toEqual([]);
  });

  it("ignores a row when its allowed decisions reject the category default", () => {
    expect(
      decisionsForCategory(
        [row("malformed", "new_in_act", ["skip"])],
        "new_in_act",
      ),
    ).toEqual([]);
  });
});
