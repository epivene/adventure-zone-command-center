import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const receiptsPage = readFileSync("src/pages/ManagerReceiptsPage.tsx", "utf8");
const receiptForm = readFileSync("src/components/manager/receipt-expense-form.tsx", "utf8");
const adminCard = readFileSync("src/components/manager-finance/admin-expense-record.tsx", "utf8");
const adminPage = readFileSync("src/pages/ManagerFinanceAdminPage.tsx", "utf8");
const map = readFileSync("src/components/manager/manager-scoped-map.tsx", "utf8");

describe("manager receipt event assignment and map containment", () => {
  it("defaults new receipt expenses to the manager's currently checked-in event and keeps assignment editable", () => {
    expect(receiptsPage).toContain("/manager/events/lifecycle/current");
    expect(receiptsPage).toContain("currentBookingId");
    expect(receiptForm).toContain("Event assignment");
    expect(receiptForm).toContain("setBookingId");
  });

  it("limits admin event suggestions to events assigned to the expense leg and sorts most recent first", () => {
    expect(adminPage).toContain("startsAt: event.startsAt ?? null");
    expect(adminCard).toContain("event.travelLegId === record.legId");
    expect(adminCard).not.toContain("!event.travelLegId || event.travelLegId === record.legId");
    expect(adminCard).toContain("new Date(b.startsAt ?? 0).getTime() - new Date(a.startsAt ?? 0).getTime()");
  });

  it("contains Leaflet inside a lower stacking context so detail sheets stay above the map", () => {
    expect(map).toContain("relative z-0");
    expect(map).toContain("isolate");
  });
});
