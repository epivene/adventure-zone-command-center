// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
  useLocation: () => ["/manager/events/booking-a/wrap-up", navigate],
}));

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
  if (path === "/manager/wrap-ups/booking-a" && options?.method === "PUT") {
    const body = JSON.parse(String(options.body));
    return { ...payload, wrapUp: { ...payload.wrapUp, ...body } };
  }
  if (path === "/manager/events/booking-a/wrap-up/review") return { review: { id: "review-a" } };
  if (path === "/manager/wrap-ups/booking-a/submit") return { ...payload, wrapUp: { ...payload.wrapUp, status: "submitted" } };
  if (path === "/manager/events/booking-a/wrap-up/finish") return { lifecycle: { bookingId: "booking-a" } };
  if (path === "/manager/events/booking-a/wrap-up/finish-later") return { lifecycle: { bookingId: "booking-a" } };
  throw new Error(`Unexpected ${path}`);
});
vi.mock("@/lib/manager-auth-context", () => ({ useManagerAuth: () => ({ managerApi: api }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ManagerEventWrapUpPage", () => {
  it("shows the shared event profile filtered to leg-manager information", async () => {
    render(<ManagerEventWrapUpPage bookingId="booking-a" />);
    expect(await screen.findByRole("heading", { name: "Dickinson Fair" })).toBeInTheDocument();
    expect(screen.getByText("Your leg · event profile")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Leg manager event report" })).toBeInTheDocument();
    expect(screen.getByLabelText("Location/address was accurate")).toBeInTheDocument();
    expect(screen.getByLabelText("Showers available")).toBeInTheDocument();
    expect(screen.getByLabelText("Forklift/loader available")).toBeInTheDocument();
    expect(screen.getByLabelText("Would we want to come back?")).toBeInTheDocument();
    expect(screen.queryByText("Money check")).not.toBeInTheDocument();
    expect(screen.queryByText("Profitability")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Actual cash on hand")).not.toBeInTheDocument();
    expect(screen.getByText(/Office closeout is separate/i)).toBeInTheDocument();
  });

  it("saves site observations before the event is fully wrapped up", async () => {
    render(<ManagerEventWrapUpPage bookingId="booking-a" />);
    await screen.findByText("Dickinson Fair");

    fireEvent.click(screen.getByLabelText("Location/address was accurate"));
    fireEvent.click(screen.getByLabelText("Forklift/loader available"));
    fireEvent.change(screen.getByLabelText("Site / organizer notes"), { target: { value: "Setup moved behind the grandstand." } });
    fireEvent.change(screen.getByLabelText("Remember for follow-up / next year"), { target: { value: "Confirm forklift two days ahead." } });
    fireEvent.change(screen.getByLabelText("Would we want to come back?"), { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save event notes" }));

    await waitFor(() => expect(api).toHaveBeenCalledWith("/manager/wrap-ups/booking-a", expect.objectContaining({ method: "PUT" })));
    const call = api.mock.calls.find((entry) => entry[0] === "/manager/wrap-ups/booking-a" && entry[1]?.method === "PUT");
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.ratingNotes).toContain("[Event site check]");
    expect(body.ratingNotes).toContain("- [x] Location/address was accurate");
    expect(body.ratingNotes).toContain("- [x] Forklift/loader available");
    expect(body.ratingNotes).toContain("Event notes: Setup moved behind the grandstand.");
    expect(body.ratingNotes).toContain("Follow-up notes: Confirm forklift two days ahead.");
    expect(body.ratingNotes).toContain("Return recommendation: yes");
    expect(await screen.findByText("Event notes saved.")).toBeInTheDocument();
  });

  it("keeps the checklist in manager feedback and finishes without office cash closeout", async () => {
    render(<ManagerEventWrapUpPage bookingId="booking-a" />);
    await screen.findByText("Dickinson Fair");
    fireEvent.click(screen.getByRole("button", { name: "5 stars" }));
    fireEvent.click(screen.getByLabelText("Contact communication was good"));
    fireEvent.click(screen.getByRole("button", { name: "Finish manager report" }));

    await waitFor(() => expect(api).toHaveBeenCalledWith("/manager/events/booking-a/wrap-up/review", expect.objectContaining({ method: "POST" })));
    const reviewCall = api.mock.calls.find((entry) => entry[0] === "/manager/events/booking-a/wrap-up/review");
    const reviewBody = JSON.parse(String(reviewCall?.[1]?.body));
    expect(reviewBody.rating).toBe(5);
    expect(reviewBody.feedback).toContain("- [x] Contact communication was good");
    expect(api).toHaveBeenCalledWith("/manager/events/booking-a/wrap-up/finish", expect.objectContaining({ method: "POST" }));
    expect(navigate).toHaveBeenCalledWith("/manager");
  });
});
