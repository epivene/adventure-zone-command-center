import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileAtAGlance } from "./profile-at-a-glance";

const profile = (effectiveEventDate: any = null) => ({
  place: { name: "River Days", applicationDeadline: null, recommendedDealModel: null },
  contacts: [], bookings: [], effectiveEventDate,
  eventDateFacts: effectiveEventDate?.displayStatus === "booked" ? [] : [{ id: effectiveEventDate?.sourceId, sourceUrl: "https://example.com/dates", sourceTitle: "Official site" }],
});

describe("ProfileAtAGlance event dates", () => {
  it.each(["booked", "confirmed", "expected"] as const)("labels a %s effective date", (displayStatus) => {
    render(<ProfileAtAGlance profile={profile({ startsOn: "2027-09-04", endsOn: "2027-09-06", displayStatus, sourceId: "date-1" })}/>);
    expect(screen.getByText(new RegExp(displayStatus, "i"))).toHaveTextContent("Sep 4, 2027–Sep 6, 2027");
    if (displayStatus !== "booked") expect(screen.getByRole("link", { name: "View source" })).toHaveAttribute("href", "https://example.com/dates");
  });
  it("shows Date not found when the resolver has no effective date", () => {
    render(<ProfileAtAGlance profile={profile()}/>);
    expect(screen.getByText("Date not found")).toBeInTheDocument();
  });
});
