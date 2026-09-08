import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventWrapUpReviewQueue } from "./event-wrap-up-review-queue";

describe("EventWrapUpReviewQueue", () => {
  it("shows the submitted event, leg, stars, cash difference, profits, warnings and submitted time", () => {
    render(<EventWrapUpReviewQueue wrapUps={[{
      event: { bookingId: "b1", name: "Dickinson Fair", legName: "Kristy", startsAt: "2026-08-15T12:00:00.000Z" },
      wrapUp: { status: "submitted", ratingStars: 4, submittedAt: "2026-08-16T02:00:00.000Z" },
      calculation: {
        settlement: { differenceCents: -2500 },
        directProfit: { profitCents: 251500 },
        trueProfit: { profitCents: null, incompleteReasons: ["Crew wage cost is incomplete"] },
      },
      finance: { missingReceiptCount: 1 },
    } as any]} />);

    fireEvent.click(screen.getByRole("button", { name: "Kristy, 1 review" }));
    fireEvent.click(screen.getByRole("button", { name: "Dickinson Fair, 1 review" }));
    expect(screen.getByRole("heading", { name: "Dickinson Fair" })).toBeInTheDocument();
    expect(screen.getByText(/Kristy/)).toBeInTheDocument();
    expect(screen.getByText("★★★★")).toBeInTheDocument();
    expect(screen.getByText("$25.00 short")).toBeInTheDocument();
    expect(screen.getByText("$2,515.00")).toBeInTheDocument();
    expect(screen.getByText("unavailable")).toBeInTheDocument();
    expect(screen.getByText(/1 receipt/)).toBeInTheDocument();
    expect(screen.getByText(/Crew wage cost is incomplete/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review wrap-up/i })).toHaveAttribute("href", "/manager-aftermath?wrapUp=b1");
  });
  it("groups wrap-ups by leg and then event", () => {
    render(<EventWrapUpReviewQueue wrapUps={[
      { event: { bookingId: "b1", name: "Dickinson Fair", legId: "leg-a", legName: "Hulk" }, wrapUp: { ratingStars: 5 }, calculation: {} },
      { event: { bookingId: "b2", name: "Logan Fair", legId: "leg-a", legName: "Hulk" }, wrapUp: { ratingStars: 4 }, calculation: {} },
    ] as any[]} />);

    const leg = screen.getByRole("button", { name: "Hulk, 2 reviews" });
    expect(screen.queryByText("Dickinson Fair")).not.toBeInTheDocument();
    fireEvent.click(leg);
    expect(screen.getByRole("button", { name: "Dickinson Fair, 1 review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logan Fair, 1 review" })).toBeInTheDocument();
  });

});