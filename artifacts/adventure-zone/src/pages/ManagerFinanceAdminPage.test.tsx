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
    expect(screen.getByText("Leg A")).toBeInTheDocument();
    expect(screen.queryByText(/Leg B/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Show archived legs"));
    expect(screen.getByText(/Leg B/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Leg A/ }));
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        "/manager-admin/legs/a/money/summary",
      ),
    );
  });
});
