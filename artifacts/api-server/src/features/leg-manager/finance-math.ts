import type { CashPositionEntry, SettlementEffect } from "./finance-types";

export function calculateCashPosition(entries: CashPositionEntry[]) {
  let cashOnHandCents = 0;
  for (const entry of entries) {
    switch (entry.kind) {
      case "advance_received":
      case "event_cash_collected":
        cashOnHandCents += entry.amountCents;
        break;
      case "expense_paid_cash":
      case "cash_turned_in":
      case "cash_returned":
        cashOnHandCents -= entry.amountCents;
        break;
      case "adjustment":
        cashOnHandCents += entry.amountCents;
        break;
      case "manager_reimbursed":
        break;
    }
  }
  return { cashOnHandCents };
}

export function calculateSettlement(effects: SettlementEffect[]) {
  // Positive net = Adventure Zone owes manager. Negative = manager owes Adventure Zone.
  let netCents = 0;
  for (const effect of effects) {
    switch (effect.kind) {
      case "personal_expense":
        netCents += effect.amountCents;
        break;
      case "manager_reimbursed":
        netCents -= effect.amountCents;
        break;
      case "advance_received":
      case "event_cash_collected":
        netCents -= effect.amountCents;
        break;
      case "expense_paid_cash":
      case "cash_turned_in":
      case "cash_returned":
        netCents += effect.amountCents;
        break;
      case "adjustment":
        // Positive adjustment means more company cash to account for.
        netCents -= effect.amountCents;
        break;
      case "company_debit_expense":
        break;
    }
  }
  return {
    ownerOwesManagerCents: Math.max(netCents, 0),
    managerOwesOwnerCents: Math.max(-netCents, 0),
    netCents,
  };
}
