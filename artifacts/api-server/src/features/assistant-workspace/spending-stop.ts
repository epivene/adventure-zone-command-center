// Stable public messages only: never expose provider payloads or credential errors.
export function spendingStopMessage(
  code: string | null | undefined,
): string | null {
  if (code === "ASSISTANT_BUDGET_LIMIT")
    return "Paused before the next paid AI request because it would not fit your remaining daily or monthly allowance. Saved results are still available. You can turn on Economy, change your limits in Spending controls, or wait for available allowance after the reset, then ask me to continue. Unresolved request holds remain reserved across resets. Changing the limit does not restart work automatically.";
  if (code === "ASSISTANT_BUDGET_CALL_EXISTS")
    return "This AI request already has a spending reservation, so it will not be repeated automatically. Saved results remain available; an unresolved request keeps its allowance reserved until its usage can be confirmed.";
  if (code === "ASSISTANT_SPENDING_MODEL_UNPRICED")
    return "Paid AI work is paused because the selected model has no verified budget price. Choose a supported model in the model selector or turn on Economy in Spending controls, then ask me to continue. Saved results remain available.";
  if (code && /^ASSISTANT_(?:SPENDING_|BUDGET_)/.test(code))
    return "Paid AI work is paused because its spending allowance or cost could not be checked. No additional generation was started for this request. Saved results remain available. Review Spending controls and try again when the check is available.";
  return null;
}
