export const legExpenseCategories = [
  "fuel", "food", "rv_park", "vehicle_maintenance", "trailer_maintenance",
  "supplies", "employee_related", "other",
] as const;
export type LegExpenseCategory = (typeof legExpenseCategories)[number];

export const legPaymentSources = ["adventure_zone_cash", "adventure_zone_debit", "personal"] as const;
export type LegPaymentSource = (typeof legPaymentSources)[number];

export const legCashEntryKinds = [
  "event_cash_collected", "expense_paid_cash", "advance_received", "cash_turned_in",
  "cash_returned", "manager_reimbursed", "adjustment",
] as const;
export type LegCashEntryKind = (typeof legCashEntryKinds)[number];

export type SettlementEffect =
  | { kind: "personal_expense"; amountCents: number }
  | { kind: "company_debit_expense"; amountCents: number }
  | { kind: LegCashEntryKind; amountCents: number };

export type CashPositionEntry = { kind: LegCashEntryKind; amountCents: number };
