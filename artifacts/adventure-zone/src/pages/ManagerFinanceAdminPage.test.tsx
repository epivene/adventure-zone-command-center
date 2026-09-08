// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerFinanceAdminPage from "./ManagerFinanceAdminPage";

const mocks = vi.hoisted(() => ({
  get: vi.fn(async (path: string) => {
    if (path === "/manager-admin/legs/access") {
      return {
        legs: [
          { legId: "a", legName: "Leg A", archivedAt: null, enabled: true },
          { legId: "b", legName: "Leg B", archivedAt: "2026-01-01", enabled: true },
        ],
      };
    }
    if (path === "/manager-admin/money/summary") {
      return {
        incomeTotalCents: 150000,
        expenseTotalCents: 50000,
        settlement: { netCents: 25000 },
      };
    }
    if (path === "/manager-admin/finance/expenses") {
      const base = {
        legId: "a", legName: "Leg A", submitterName: "Amy", bookingId: "event-a",
        bookingName: "Dickinson Fair", tripId: null, tripSegmentId: null,
        assignmentSource: "explicit", assignmentReason: null, category: "fuel",
        amountCents: 1000, taxCents: 0, totalCents: 1000, paymentSource: "adventure_zone_debit",
        occurredAt: "2026-08-01T12:00:00.000Z", notes: null, employeeNote: null,
        submittedAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z",
        receipt: null, audit: [],
      };
      return { records: [
        { ...base, id: "expense-a", merchant: "Fuel Stop" },
        { ...base, id: "expense-b", merchant: "Supply Store" },
        { ...base, id: "expense-c", bookingId: null, bookingName: null, merchant: "Unknown Event" },
      ] };
    }
    if (path === "/routes") return { events: [] };
    return {
      incomeTotalCents: 100000,
      expenseTotalCents: 30000,
      settlement: { netCents: 20000 },
      expenses: [],
    };
  }),
}));

vi.mock("@/lib/auth-token", () => ({ apiGet: mocks.get }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ManagerFinanceAdminPage", () => {
  it("shows combined totals and filters archived legs", async () => {
    render(<ManagerFinanceAdminPage />);
    expect(await screen.findByText("$1,500.00")).toBeInTheDocument();
    expect(screen.getAllByText("Leg A").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Leg B/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Show archived legs"));
    expect(screen.getByRole("button", { name: "Leg B — Archived" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Leg A" }));
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        "/manager-admin/legs/a/money/summary",
      ),
    );
  });
  it("shows receipts inside event groups nested under their leg", async () => {
    render(<ManagerFinanceAdminPage />);

    const leg = await screen.findByRole("button", { name: "Leg A, 3 receipts" });
    expect(screen.queryByText("Fuel Stop")).not.toBeInTheDocument();
    fireEvent.click(leg);

    expect(screen.getByRole("button", { name: "Dickinson Fair, 2 receipts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unassigned event, 1 receipt" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dickinson Fair, 2 receipts" }));
    expect(screen.getByText("Fuel Stop")).toBeInTheDocument();
    expect(screen.getByText("Supply Store")).toBeInTheDocument();
  });

});
