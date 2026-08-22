// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttendanceHistoryCard } from "./attendance-history-card";

describe("AttendanceHistoryCard", () => {
  it("shows approved business attendance history separately from audit history", () => {
    render(
      <AttendanceHistoryCard
        history={[
          {
            id: "h1",
            year: 2026,
            month: "AUGUST",
            status: "attended",
            sourceEventName: "County Fair",
            sourceLocation: "Miles City MT",
            organizationLocationId: null,
          },
          {
            id: "h2",
            year: 2025,
            month: "JUNE",
            status: "cancelled_last_minute",
            sourceEventName: "Summer Fest",
            sourceLocation: "Casper WY",
            organizationLocationId: null,
          },
          {
            id: "h3",
            year: 2024,
            month: "MAY",
            status: "blacklisted",
            sourceEventName: "Source Event",
            sourceLocation: "Source City ND",
            organizationLocationId: null,
          },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Attendance history" })).toBeInTheDocument();
    expect(screen.getByText("2026 · Attended")).toBeInTheDocument();
    expect(screen.getByText("2025 · Cancelled last minute")).toBeInTheDocument();
    expect(screen.getByText("2024 · Blacklisted")).toBeInTheDocument();
    expect(screen.getByText("AUGUST · Miles City MT")).toBeInTheDocument();
    expect(screen.getByText("Historical event attendance from reviewed source records.")).toBeInTheDocument();
  });

  it("stays out of the way when no approved history exists", () => {
    const { container } = render(<AttendanceHistoryCard history={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
