import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LeadScoutCandidateCard } from "./lead-scout-candidate-card";
import type { LeadScoutCandidate } from "@/features/assistant/assistant-types";

function candidate(status: LeadScoutCandidate["crmMatchStatus"]): LeadScoutCandidate {
  return {
    id: "c1", name: "Silver Valley Days", city: "Kellogg", region: "ID", venue: "Downtown",
    startsAt: "2026-09-11", endsAt: "2026-09-13", organizerName: null, organizerEmail: null,
    organizerPhone: null, website: "https://example.org/silver", eventType: "community festival",
    recurrenceSummary: null, attendanceSummary: null, vendorSummary: null, applicationDeadline: null,
    fitScore: 80, fitRationale: "Family event on the requested corridor", crmMatchStatus: status,
    matchedOrganizationId: status === "new_prospect" ? null : "org-1", matchedBookingId: null,
    reviewStatus: "unreviewed", savedOrganizationId: null, savedBookingId: null, facts: [],
  };
}

describe("LeadScoutCandidateCard", () => {
  it("shows new web discoveries as Unsaved prospect profiles", () => {
    render(<LeadScoutCandidateCard candidate={candidate("new_prospect")} />);
    expect(screen.getByText("Unsaved prospect")).toBeTruthy();
    expect(screen.getByText("Silver Valley Days")).toBeTruthy();
    expect(screen.getByText(/Sep 11.*Sep 13/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute("href", "https://example.org/silver");
  });

  it("labels existing CRM matches instead of presenting them as new", () => {
    render(<LeadScoutCandidateCard candidate={candidate("existing")} />);
    expect(screen.getByText("Already in Command Center")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open profile" })).toHaveAttribute("href", "/profiles/org-1");
  });

  it("makes possible matches visibly review-only", () => {
    render(<LeadScoutCandidateCard candidate={candidate("possible_match")} />);
    expect(screen.getByText("Possible match")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review match" })).toHaveAttribute("href", "/profiles/org-1");
  });
});
