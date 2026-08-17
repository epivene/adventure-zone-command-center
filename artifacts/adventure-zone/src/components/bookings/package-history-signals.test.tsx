import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PackageHistorySignals } from "./package-history-signals";

describe("PackageHistorySignals", () => {
  it("renders plain-language package, count, paintball, and timing comparisons with sources", () => {
    render(
      <PackageHistorySignals
        comparison={{
          currentBookingId: "current",
          sources: [
            { bookingId: "prior-1", eventStartAt: "2025-07-10T12:00:00.000Z", label: "2025 County Fair" },
            { bookingId: "prior-2", eventStartAt: "2024-07-10T12:00:00.000Z", label: "2024 County Fair" },
          ],
          signals: [
            {
              kind: "usual_package_mix",
              packageNames: ["Adventure Zone", "Pirate's Rebellion"],
              sourceBookingIds: ["prior-1", "prior-2"],
            },
            {
              kind: "main_attraction_difference",
              previousCount: 12,
              currentCount: 9,
              difference: -3,
              sourceBookingId: "prior-1",
            },
            {
              kind: "missing_prior_resource",
              resourceId: "paintball",
              resourceName: "Paintball trailer",
              sourceBookingId: "prior-1",
            },
            {
              kind: "usual_event_month",
              month: 7,
              sampleBookingIds: ["prior-1", "prior-2"],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("They usually book Adventure Zone + Pirate's Rebellion.")).toBeInTheDocument();
    expect(screen.getByText(/this booking has 9 \(3 fewer\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Paintball trailer was included/i)).toBeInTheDocument();
    expect(screen.getByText(/usually falls in July/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Based on 2025 County Fair/i })[0]).toHaveAttribute(
      "href",
      "/bookings/prior-1",
    );
    expect(screen.getByText(/Nothing is copied into this booking automatically/i)).toBeInTheDocument();
  });

  it("renders nothing when there are no signals", () => {
    const { container } = render(
      <PackageHistorySignals
        comparison={{ currentBookingId: "current", signals: [], sources: [] }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
