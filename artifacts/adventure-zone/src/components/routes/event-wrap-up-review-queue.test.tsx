import { render, screen } from "@testing-library/react";
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

    expect(screen.getByText("Dickinson Fair")).toBeInTheDocument();
    expect(screen.getByText(/Kristy/)).toBeInTheDocument();
    expect(screen.getByText("★★★★")).toBeInTheDocument();
    expect(screen.getByText("$25.00 short")).toBeInTheDocument();
    expect(screen.getByText(/Direct profit: \$2,515.00/)).toBeInTheDocument();
    expect(screen.getByText(/Estimated true profit: unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/1 receipt/)).toBeInTheDocument();
    expect(screen.getByText(/Crew wage cost is incomplete/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review wrap-up/i })).toHaveAttribute("href", "/manager-aftermath?wrapUp=b1");
  });
});