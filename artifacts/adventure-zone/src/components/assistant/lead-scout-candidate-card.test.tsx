import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LeadScoutCandidateCard } from "./lead-scout-candidate-card";
import type { LeadScoutCandidate, LeadScoutSource } from "@/features/assistant/assistant-types";

const sources: LeadScoutSource[] = [
  { id: "s1", url: "https://example.org/vendors", title: "Official vendor application", publisher: "Silver Valley Days", category: "vendor_application", retrievedAt: "2026-08-19T18:00:00.000Z" },
  { id: "s2", url: "https://facebook.com/events/example", title: "Public Facebook event", publisher: "Facebook", category: "social", retrievedAt: "2026-08-19T18:00:00.000Z" },
];

function candidate(status: LeadScoutCandidate["crmMatchStatus"]): LeadScoutCandidate {
  return {
    id: "c1", name: "Silver Valley Days", city: "Kellogg", region: "ID", venue: "Downtown",
    startsAt: "2026-09-11", endsAt: "2026-09-13", organizerName: "Jamie Organizer", organizerEmail: "events@example.org",
    organizerPhone: "555-0100", website: "https://example.org/silver", eventType: "community festival",
    recurrenceSummary: "Annual September festival", attendanceSummary: "About 8,000 attendees last year",
    vendorSummary: "Vendor applications are open", applicationDeadline: "2026-06-01",
    fitScore: 87, fitRationale: "Strong family and vendor fit", fitReasons: ["family-focused audience", "published vendor participation path"],
    fitCautions: ["Confirm available attraction footprint with organizer"], crmMatchStatus: status,
    matchedOrganizationId: status === "new_prospect" ? null : "org-1", matchedBookingId: null,
    reviewStatus: "unreviewed", enrichmentStatus: "enriched",
    coverageGaps: ["No official power requirements were published."], enrichmentError: null,
    enrichedAt: "2026-08-19T18:10:00.000Z", deepenRequestedAt: null,
    savedOrganizationId: null, savedBookingId: null,
    facts: [
      { id: "f1", key: "vendor_deadline", value: "2026-06-01", category: "vendor", confidence: "high", rationale: "Official application", sourceIds: ["s1"] },
      { id: "f2", key: "family_feedback", value: "Public comments and photos show strong family turnout", category: "social_review", confidence: "medium", rationale: "Public social evidence", sourceIds: ["s2"] },
    ],
  };
}

describe("LeadScoutCandidateCard", () => {
  it("shows enriched new prospects as compact unsaved profiles", () => {
    render(<LeadScoutCandidateCard candidate={candidate("new_prospect")} sources={sources} onResearchDeeper={vi.fn()} />);
    expect(screen.getByText("Unsaved prospect")).toBeTruthy();
    expect(screen.getByText("Silver Valley Days")).toBeTruthy();
    expect(screen.getByText(/Sep 11.*Sep 13/i)).toBeTruthy();
    expect(screen.getByText(/Vendor applications are open/i)).toBeTruthy();
    expect(screen.getByText(/Jamie Organizer/i)).toBeTruthy();
    expect(screen.getByText(/8,000 attendees/i)).toBeTruthy();
    expect(screen.getByText(/87\/100/i)).toBeTruthy();
    expect(screen.getByText(/Confirm available attraction footprint/i)).toBeTruthy();
    expect(screen.getByText(/No official power requirements/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Research deeper" })).toBeTruthy();
  });

  it("shows source-backed research details and labels social/review evidence qualitatively", () => {
    render(<LeadScoutCandidateCard candidate={candidate("new_prospect")} sources={sources} onResearchDeeper={vi.fn()} />);
    fireEvent.click(screen.getByText("Research details"));
    expect(screen.getByText(/Public social\/review signal/i)).toBeTruthy();
    expect(screen.getByText(/Public comments and photos show strong family turnout/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Official vendor application" })).toHaveAttribute("href", "https://example.org/vendors");
    expect(screen.getByRole("link", { name: "Public Facebook event" })).toHaveAttribute("href", "https://facebook.com/events/example");
  });

  it("fires Research deeper and disables duplicate requests while enriching", () => {
    const onResearchDeeper = vi.fn();
    const { rerender } = render(<LeadScoutCandidateCard candidate={candidate("new_prospect")} sources={sources} onResearchDeeper={onResearchDeeper} />);
    fireEvent.click(screen.getByRole("button", { name: "Research deeper" }));
    expect(onResearchDeeper).toHaveBeenCalledWith("c1");

    rerender(<LeadScoutCandidateCard candidate={{ ...candidate("new_prospect"), enrichmentStatus: "enriching" }} sources={sources} onResearchDeeper={onResearchDeeper} />);
    expect(screen.getByRole("button", { name: "Researching deeper…" })).toHaveProperty("disabled", true);
  });

  it("keeps a failed enrichment visible as Needs more research", () => {
    render(<LeadScoutCandidateCard
      candidate={{ ...candidate("new_prospect"), enrichmentStatus: "enrichment_failed", enrichmentError: "Vendor page unavailable" }}
      sources={sources}
      onResearchDeeper={vi.fn()}
    />);
    expect(screen.getByText("Needs more research")).toBeTruthy();
    expect(screen.getByText(/Vendor page unavailable/i)).toBeTruthy();
  });

  it("labels existing and possible CRM matches instead of presenting them as new", () => {
    const { rerender } = render(<LeadScoutCandidateCard candidate={candidate("existing")} sources={sources} onResearchDeeper={vi.fn()} />);
    expect(screen.getByText("Already in Command Center")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open profile" })).toHaveAttribute("href", "/profiles/org-1");

    rerender(<LeadScoutCandidateCard candidate={candidate("possible_match")} sources={sources} onResearchDeeper={vi.fn()} />);
    expect(screen.getByText("Possible match")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review match" })).toHaveAttribute("href", "/profiles/org-1");
  });
});
