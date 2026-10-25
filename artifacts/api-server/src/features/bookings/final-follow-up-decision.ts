export type FinalFollowUpFields = {
  finalNextActionKind?: string | null;
  finalNextActionDueAt?: Date | null;
  finalNoFurtherActionReason?: string | null;
};
export function finalFollowUpDecision(
  before: string,
  after: string,
  input: FinalFollowUpFields,
  now: Date,
):
  | { kind: "none"; reason: string }
  | { kind: "schedule"; action: string; dueAt: Date }
  | null {
  if (
    before === after ||
    ![
      "confirmed",
      "declined",
      "cancelled",
      "completed",
      "booked",
      "not_pursuing",
    ].includes(after)
  )
    return null;
  const reason = input.finalNoFurtherActionReason?.trim(),
    action = input.finalNextActionKind?.trim(),
    due = input.finalNextActionDueAt;
  if (reason && !action && !due) return { kind: "none", reason };
  if (!reason && action && due && Number.isFinite(due.getTime()) && due > now)
    return { kind: "schedule", action, dueAt: due };
  throw Object.assign(
    new Error(
      "Choose a future next action or give an explicit no-further-action reason before closing this booking.",
    ),
    { code: "FINAL_FOLLOW_UP_DECISION_REQUIRED" },
  );
}
