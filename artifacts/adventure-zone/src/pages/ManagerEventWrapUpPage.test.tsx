// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerEventWrapUpPage from "./ManagerEventWrapUpPage";

const payload = {
  event: { bookingId: "booking-a", name: "Dickinson Fair", city: "Dickinson", region: "ND", startsAt: "2026-08-15T18:00:00.000Z", endsAt: "2026-08-15T23:00:00.000Z", legId: "leg-a", legName: "Kristy", tripId: "trip-a", tripName: "Dakotas" },
  wrapUp: { id: "wrap-a", bookingId: "booking-a", legId: "leg-a", tripId: "trip-a", status: "draft", ratingStars: 4, ratingNotes: "Good turnout", actualCashOnHandCents: 171500, cashDifferenceNote: "Counted twice" },
  calculation: {
    settlement: { cashIncomeCents: 180000, otherCashIncomeCents: 5000, cashExpensesCents: 12000, expectedCashCents: 173000, actualCashCents: 171500, differenceCents: -1500 },
    travel: { tripMiles: 200, automaticMiles: 100, appliedMiles: 100, mpg: 10, fuelPricePerGallon: 3.5, estimatedFuelCostCents: 3500, actualAllocatedFuelCostCents: null, allocatedFuelCostCents: 3500, source: "automatic" },
    directProfit: { revenueCents: 275000, directExpenseCents: 20000, travelCostCents: 3500, adjustmentsCents: 0, profitCents: 251500 },
    trueProfit: { directProfitCents: 251500, crewWagesCents: null, overheadCents: 25000, adjustmentsCents: 0, profitCents: null, incompleteReasons: ["Crew wage cost is incomplete"] },
  },
  finance: { cashCents: 180000, squareCents: 90000, otherCents: 5000, totalRevenueCents: 275000, directExpenses: [], missingReceiptCount: 1 },
  travel: { tripMiles: 200, automaticMiles: 100, appliedMiles: 100, mpg: 10, fuelPricePerGallon: 3.5, automaticSharePercent: 50 },
  adjustments: [], overhead: { amountCents: 25000, label: "Season overhead" },
  warnings: ["1 expense receipt is missing or incomplete", "Crew wage cost is incomplete"],
};

const api = vi.fn(async (path: string, options?: RequestInit) => {
  if (path === "/manager/wrap-ups/booking-a" && (!options?.method || options.method === "GET")) return payload;
  if (path === "/manager/wrap-ups/booking-a" && options?.method === "PUT") return payload;
  if (path === "/manager/wrap-ups/booking-a/submit") return { ...payload, wrapUp: { ...payload.wrapUp, status: "submitted" } };
  throw new Error(`Unexpected ${path}`);
});
vi.mock("@/lib/manager-auth-context", () => ({ useManagerAuth: () => ({ managerApi: api }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ManagerEventWrapUpPage", () => {
  it("shows the approved single-screen wrap-up sections without the old return recommendation", async () => {
    render(<ManagerEventWrapUpPage bookingId="booking-a" />);
    expect(await screen.findByRole("heading", { name: "Event Wrap-Up" })).toBeInTheDocument();
    expect(screen.getByText("Dickinson Fair")).toBeInTheDocument();
    expect(screen.getByText("How did it go?")).toBeInTheDocument();
    expect(screen.getByText("Money check")).toBeInTheDocument();
    expect(screen.getByText("Receipts & expenses")).toBeInTheDocument();
    expect(screen.getByText("Travel share")).toBeInTheDocument();
    expect(screen.getByText("Profitability")).toBeInTheDocument();
    expect(screen.getByText("$15.00 short")).toBeInTheDocument();
    expect(screen.getByText("$2,515.00")).toBeInTheDocument();
    expect(screen.getByText(/Crew wage cost is incomplete/)).toBeInTheDocument();
    expect(screen.queryByText(/Recommend return/i)).not.toBeInTheDocument();
  });

  it("saves stars, one notes field, cash count and discrepancy note as a draft", async () => {
    render(<ManagerEventWrapUpPage bookingId="booking-a" />);
    await screen.findByText("Dickinson Fair");
    fireEvent.click(screen.getByRole("button", { name: "5 stars" }));
    fireEvent.change(screen.getByLabelText("Event notes"), { target: { value: "Excellent event" } });
    fireEvent.change(screen.getByLabelText("Actual cash on hand"), { target: { value: "1720.00" } });
    fireEvent.change(screen.getByLabelText("Cash difference note"), { target: { value: "Small count difference" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/manager/wrap-ups/booking-a", expect.objectContaining({ method: "PUT" })));
    const call = api.mock.calls.find((entry) => entry[0] === "/manager/wrap-ups/booking-a" && entry[1]?.method === "PUT");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ ratingStars: 5, ratingNotes: "Excellent event", actualCashOnHandCents: 172000, cashDifferenceNote: "Small count difference" });
  });

  it("submits the saved wrap-up for admin review", async () => {
    render(<ManagerEventWrapUpPage bookingId="booking-a" />);
    await screen.findByText("Dickinson Fair");
    fireEvent.click(screen.getByRole("button", { name: "Submit wrap-up" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/manager/wrap-ups/booking-a/submit", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("Submitted for admin review")).toBeInTheDocument();
  });
});
