import type {
  SyncComparisonCategory,
  SyncComparisonRow,
  SyncDecision,
} from "@/features/act-sync/sync-comparison";
import type { SyncApplyDecision } from "@/features/act-sync/sync-service";

const safeCategoryDecisions: Partial<
  Record<SyncComparisonCategory, SyncDecision>
> = {
  new_in_act: "pull",
  new_in_app: "push",
  changed_in_act: "pull",
  changed_in_app: "push",
};

export function safeDecisionForCategory(
  category: SyncComparisonCategory,
): SyncDecision | undefined {
  return safeCategoryDecisions[category];
}

export function decisionsForCategory(
  rows: readonly SyncComparisonRow[],
  category: SyncComparisonCategory,
): SyncApplyDecision[] {
  const decision = safeDecisionForCategory(category);
  if (!decision) return [];
  return rows
    .filter(
      (row) =>
        row.category === category &&
        row.allowedDecisions.includes(decision),
    )
    .map((row) => ({ rowId: row.rowId, decision }));
}
