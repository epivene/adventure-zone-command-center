import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileAtAGlance } from "./profile-at-a-glance";

const profile = (effectiveEventDate: any = null) => ({
  place: {
    name: "River Days",
    applicationDeadline: null,
    recommendedDealModel: null,
  },
  contacts: [],
  bookings: [],
  effectiveEventDate,
  eventDateFacts:
    effectiveEventDate?.displayStatus === "booked"
      ? []
      : [
          {
            id: effectiveEventDate?.sourceId,
            sourceUrl: "https://example.com/dates",
            sourceTitle: "Official site",
          },
        ],
});

describe("ProfileAtAGlance event dates", () => {
  it("offers date review on the profile and hides it in a read-only presentation", () => {
    const view = render(<ProfileAtAGlance profile={profile()} profileId="miles-city" />);
    expect(screen.getByRole("button", {name:"Review event dates"})).toBeInTheDocument();
    view.rerender(<ProfileAtAGlance profile={profile()} profileId="miles-city" allowDateManagement={false} />);
    expect(screen.queryByRole("button", {name:"Review event dates"})).not.toBeInTheDocument();
  });
  it.each(["booked", "confirmed", "expected"] as const)(
    "labels a %s effective date",
    (displayStatus) => {
      render(
        <ProfileAtAGlance
          profile={profile({
            startsOn: "2027-09-04",
            endsOn: "2027-09-06",
            displayStatus,
            sourceId: "date-1",
          })}
        />,
      );
      expect(
        screen.getByText(new RegExp(displayStatus === "expected" ? "Estimated" : displayStatus, "i")),
      ).toHaveTextContent("Sep 4, 2027–Sep 6, 2027");
      if (displayStatus !== "booked")
        expect(
          screen.getByRole("link", { name: "View source" }),
        ).toHaveAttribute("href", "https://example.com/dates");
    },
  );
  it("uses existing profile facts without filling empty booking fields with placeholders", () => {
    render(
      <ProfileAtAGlance
        profile={{
          ...profile(),
          bookings: [
            { id: "past", startsAt: "2025-08-15", status: "completed" },
          ],
          contacts: [
            {
              id: "contact",
              name: "Alex Organizer",
              email: "alex@example.com",
              isPrimary: false,
            },
          ],
          notes: [
            {
              id: "note",
              kind: "note",
              body: "Organizer asked us to follow up in October.",
              occurredAt: "2026-09-01",
            },
          ],
          decisionSummary: {
            nextActionKind: "email",
            nextActionDueAt: "2026-10-01",
          },
        }}
        now={new Date("2026-09-28T12:00:00Z")}
      />,
    );
    expect(screen.getByText("Upcoming date not recorded")).toBeInTheDocument();
    expect(
      screen.getByText(/Last recorded date: Aug 15, 2025/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Find next date" }),
    ).toHaveAttribute(
      "href",
      "/settings/event-date-coverage?search=River%20Days",
    );
    expect(screen.getByText("Alex Organizer")).toBeInTheDocument();
    expect(
      screen.getByText("Organizer asked us to follow up in October."),
    ).toBeInTheDocument();
    expect(screen.getByText("Email · Due Oct 1, 2026")).toBeInTheDocument();
    expect(
      screen.queryByText("No recommendation recorded"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Not recorded")).not.toBeInTheDocument();
    expect(screen.queryByText("No primary contact")).not.toBeInTheDocument();
  });

  it("keeps recorded booking details visible", () => {
    render(
      <ProfileAtAGlance
        profile={{
          ...profile({
            startsOn: "2027-09-04",
            endsOn: null,
            displayStatus: "booked",
            sourceId: "booking",
          }),
          place: {
            name: "River Days",
            applicationDeadline: "2027-02-01",
            recommendedDealModel: "flat_fee",
          },
          decisionSummary: {
            priority: "high",
            pipelineStatus: "in_discussion",
          },
          contacts: [
            { id: "contact", name: "Alex Organizer", isPrimary: true },
          ],
        }}
      />,
    );
    expect(screen.getByText("Feb 1, 2027")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("In Discussion")).toBeInTheDocument();
    expect(screen.getByText("Flat fee")).toBeInTheDocument();
    expect(screen.getByText("Primary contact")).toBeInTheDocument();
  });
});

