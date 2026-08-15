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
  let ownerOwesManagerCents = 0;
  let managerOwesOwnerCents = 0;
  for (const effect of effects) {
    switch (effect.kind) {
      case "personal_expense":
        ownerOwesManagerCents += effect.amountCents;
        break;
      case "manager_reimbursed":
        ownerOwesManagerCents = Math.max(0, ownerOwesManagerCents - effect.amountCents);
        break;
      case "advance_received":
      case "event_cash_collected":
        managerOwesOwnerCents += effect.amountCents;
        break;
      case "expense_paid_cash":
      case "cash_turned_in":
      case "cash_returned":
        managerOwesOwnerCents = Math.max(0, managerOwesOwnerCents - effect.amountCents);
        break;
      case "adjustment":
        if (effect.amountCents >= 0) managerOwesOwnerCents += effect.amountCents;
        else managerOwesOwnerCents = Math.max(0, managerOwesOwnerCents + effect.amountCents);
        break;
      case "company_debit_expense":
        break;
    }
  }
  return {
    ownerOwesManagerCents,
    managerOwesOwnerCents,
    netCents: ownerOwesManagerCents - managerOwesOwnerCents,
  };
}
