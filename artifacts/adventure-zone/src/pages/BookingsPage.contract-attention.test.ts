import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isContractAttentionBooking } from "./BookingsPage";

describe("contract attention queue", () => {
  it("matches exactly the statuses counted by Today", () => {
    expect(isContractAttentionBooking({ status: "pending_contract" })).toBe(true);
    expect(isContractAttentionBooking({ status: "contract_received" })).toBe(true);
    expect(isContractAttentionBooking({ status: "pending_decision" })).toBe(false);
    expect(isContractAttentionBooking({ status: "confirmed" })).toBe(false);
  });

  it("routes the Today contract action to the focused queue", () => {
    const todaySource = readFileSync("src/pages/TodayPage.tsx", "utf8");
    expect(todaySource).toContain('href="/bookings?attention=contracts"');
  });
});
