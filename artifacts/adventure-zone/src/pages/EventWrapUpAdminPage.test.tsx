import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EventWrapUpAdminPage from "./EventWrapUpAdminPage";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPut: vi.fn(), apiPost: vi.fn() }));
vi.mock("@/lib/auth-token", () => ({ apiGet: mocks.apiGet, apiPut: mocks.apiPut, apiPost: mocks.apiPost }));

const payload = {
  event: { bookingId: "b1", name: "Dickinson Fair", legName: "Kristy", tripId: "11111111-1111-4111-8111-111111111111", startsAt: "2026-08-15T12:00:00.000Z" },
  wrapUp: { status: "submitted", ratingStars: 4, ratingNotes: "Good turnout", actualCashOnHandCents: 181700, cashDifferenceNote: "", submittedAt: "2026-08-16T02:00:00.000Z" },
  calculation: {
    settlement: { expectedCashCents: 184200, differenceCents: -2500 },
    directProfit: { profitCents: 251500 },
    trueProfit: { profitCents: null, incompleteReasons: ["Crew wage cost is incomplete"] },
  },
  finance: { missingReceiptCount: 1 },
  travel: { automaticMiles: 100, appliedMiles: 100 },
  overhead: null,
  adjustments: [],
  sourceDataChanged: false,
};

describe("EventWrapUpAdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockResolvedValue(payload);
    mocks.apiPut.mockResolvedValue(payload);
    mocks.apiPost.mockResolvedValue({ wrapUp: { ...payload.wrapUp, status: "reviewed" } });
  });

  it("lets admin review a submitted wrap-up and requires reasons for accounting overrides", async () => {
    render(<EventWrapUpAdminPage bookingId="b1" />);
    expect(await screen.findByText("Dickinson Fair")).toBeInTheDocument();
    expect(screen.getByText("$25.00 short")).toBeInTheDocument();
    expect(screen.getByText(/Estimated true profit unavailable/)).toBeInTheDocument();
    expect(screen.getByLabelText("Travel override reason")).toBeRequired();
    expect(screen.getByLabelText("Overhead reason")).toBeRequired();
    expect(screen.getByLabelText("Adjustment reason")).toBeRequired();

    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/event-wrap-up-admin/b1/review", {}));
  });

  it("warns and offers reopen when reviewed source data changed", async () => {
    mocks.apiGet.mockResolvedValue({ ...payload, sourceDataChanged: true, wrapUp: { ...payload.wrapUp, status: "reviewed" } });
    render(<EventWrapUpAdminPage bookingId="b1" />);
    expect(await screen.findByText(/Source finance\/travel data changed after review/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reopen wrap-up" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/event-wrap-up-admin/b1/reopen", {}));
  });
});