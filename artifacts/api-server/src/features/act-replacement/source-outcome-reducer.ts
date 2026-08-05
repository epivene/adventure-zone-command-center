import type { ActOperationExecutionState } from "./import-types";

export type SourceOperationState = {
  requiredForSourceOutcome: boolean;
  executionState: ActOperationExecutionState;
  blockReason: string | null;
};

/** Reduce only required work; optional diagnostics must never block an outcome. */
export function reduceSourceOutcome(
  operations: readonly SourceOperationState[],
): "ready" | "applied" | "already_present" | "awaiting_review" | "failed" {
  const required = operations.filter((operation) => operation.requiredForSourceOutcome);
  if (required.some((operation) => operation.executionState === "failed")) return "failed";
  if (required.some((operation) => operation.executionState === "blocked" || operation.blockReason)) return "awaiting_review";
  if (required.some((operation) => operation.executionState === "pending" || operation.executionState === "leased")) return "ready";
  if (required.length > 0 && required.every((operation) => operation.executionState === "already_present")) return "already_present";
  if (required.length > 0 && required.every((operation) => operation.executionState === "applied" || operation.executionState === "already_present")) return "applied";
  return "ready";
}
