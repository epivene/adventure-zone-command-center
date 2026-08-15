import { describe, expect, it } from "vitest";
import { calculateCashPosition, calculateSettlement } from "./finance-math";

describe("calculateSettlement", () => {
  it("tracks personal expenses and manager reimbursement", () => {
    expect(calculateSettlement([
      { kind: "personal_expense", amountCents: 5000 },
      { kind: "manager_reimbursed", amountCents: 2000 },
    ])).toEqual({ ownerOwesManagerCents: 3000, managerOwesOwnerCents: 0, netCents: 3000 });
  });

  it("allows over-reimbursement to flip who owes whom", () => {
    expect(calculateSettlement([
      { kind: "personal_expense", amountCents: 1000 },
      { kind: "manager_reimbursed", amountCents: 1500 },
    ])).toEqual({ ownerOwesManagerCents: 0, managerOwesOwnerCents: 500, netCents: -500 });
  });

  it("does not treat company debit expenses as personal settlement", () => {
    expect(calculateSettlement([
      { kind: "company_debit_expense", amountCents: 7250 },
    ])).toEqual({ ownerOwesManagerCents: 0, managerOwesOwnerCents: 0, netCents: 0 });
  });

  it("holds advances and event cash until they are accounted for", () => {
    expect(calculateSettlement([
      { kind: "advance_received", amountCents: 10000 },
      { kind: "event_cash_collected", amountCents: 4000 },
      { kind: "expense_paid_cash", amountCents: 2500 },
      { kind: "cash_turned_in", amountCents: 7000 },
      { kind: "cash_returned", amountCents: 1000 },
    ])).toEqual({ ownerOwesManagerCents: 0, managerOwesOwnerCents: 3500, netCents: -3500 });
  });
});

describe("calculateCashPosition", () => {
  it("derives cash on hand from append-only cash entries", () => {
    expect(calculateCashPosition([
      { kind: "advance_received", amountCents: 10000 },
      { kind: "event_cash_collected", amountCents: 4000 },
      { kind: "expense_paid_cash", amountCents: 2500 },
      { kind: "cash_turned_in", amountCents: 7000 },
      { kind: "cash_returned", amountCents: 1000 },
      { kind: "adjustment", amountCents: -500 },
    ])).toEqual({ cashOnHandCents: 3000 });
  });
});
