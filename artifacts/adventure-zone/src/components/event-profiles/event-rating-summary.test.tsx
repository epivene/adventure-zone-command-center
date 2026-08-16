import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventRatingSummary } from "./event-rating-summary";

describe("EventRatingSummary", () => {
  it("shows average stars and rated occurrence count", () => {
    render(<EventRatingSummary average={4.25} count={4} />);
    expect(screen.getByText("Average rating")).toBeInTheDocument();
    expect(screen.getByText("4.3 / 5")).toBeInTheDocument();
    expect(screen.getByText("4 rated occurrences")).toBeInTheDocument();
  });

  it("does not invent a rating when there are no rated occurrences", () => {
    render(<EventRatingSummary average={null} count={0} />);
    expect(screen.getByText("No rated occurrences yet")).toBeInTheDocument();
  });
});