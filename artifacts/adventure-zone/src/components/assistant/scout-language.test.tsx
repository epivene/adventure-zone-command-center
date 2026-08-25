import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LeadScoutCandidate, LeadScoutRunView } from "@/features/assistant/assistant-types";
import { LeadDiscoveryResults } from "./lead-discovery-results";
import { LeadScoutSaveDialog } from "./lead-scout-save-dialog";

const candidate: LeadScoutCandidate = {
  id: "candidate-1",
  name: "Twin Falls County Fair",
  city: "Filer",
  region: "ID",
  venue: "Twin Falls County Fairgrounds",
  startsAt: "2026-09-02",
  endsAt: "2026-09-07",
  organizerName: "Fair Office",
  organizerEmail: "fair@example.org",
  organizerPhone: "208-555-0100",
  website: "https://example.org/fair",
  eventType: "county fair",
  recurrenceSummary: "Annual Labor Day fair",
  attendanceSummary: "Family-oriented regional attendance",
  vendorSummary: "Potential outside attraction opportunity",
  applicationDeadline: null,
  fitScore: 87,
  fitRationale: "Strong family fit along the active travel corridor",
  fitReasons: ["Family-friendly county fair", "Fits the route"],
  fitCautions: ["Confirm that no inflatable provider is already contracted"],
  crmMatchStatus: "new_prospect",
  matchedOrganizationId: null,
  matchedBookingId: null,
  reviewStatus: "unreviewed",
  enrichmentStatus: "enriched",
  coverageGaps: ["Power access is not confirmed"],
  enrichmentError: null,
  enrichedAt: "2026-08-25T12:00:00.000Z",
  deepenRequestedAt: null,
  savedOrganizationId: null,
  savedBookingId: null,
  facts: [],
};

function run(overrides: Partial<LeadScoutRunView> = {}): LeadScoutRunView {
  return {
    id: "run-1",
    originalQuestion: "Find a Labor Day event for Kristy's route",
    criteria: null,
    criteriaSummary: "Labor Day 2026 · Kristy's route · family friendly",
    status: "complete",
    stage: "complete",
    progress: {
      label: "Scout search complete",
      sourcesChecked: 4,
      candidatesFound: 1,
      candidatesEnriched: 1,
      candidatesCompared: 1,
    },
    crmMatches: [],
    candidates: [candidate],
    sources: [],
    startedAt: "2026-08-25T12:00:00.000Z",
    completedAt: "2026-08-25T12:10:00.000Z",
    createdAt: "2026-08-25T12:00:00.000Z",
    updatedAt: "2026-08-25T12:10:00.000Z",
    failureMessage: null,
    ...overrides,
  };
}

describe("approved Scout language", () => {
  it("presents temporary discoveries as Scout Results with a Scout Score", () => {
    render(
      <LeadDiscoveryResults
        run={run()}
        webScoutAvailable
        onOpenProfile={vi.fn()}
        onUseContext={vi.fn()}
        onFindNewLeads={vi.fn()}
        onSaveCandidate={vi.fn()}
      />,
    );

    expect(screen.getByText("Scout Results")).toBeTruthy();
    expect(screen.getByText("Found")).toBeTruthy();
    expect(screen.getByText("Scout Score: 87%")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Profile" })).toBeTruthy();
  });

  it("calls the public discovery action Scout Search", () => {
    render(
      <LeadDiscoveryResults
        run={run({ status: "crm_ready", stage: "crm_search", candidates: [], completedAt: null })}
        webScoutAvailable
        onOpenProfile={vi.fn()}
        onUseContext={vi.fn()}
        onFindNewLeads={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Start Scout Search" })).toBeTruthy();
  });

  it("reviews the accepted result as a Scout Profile Draft", () => {
    render(
      <LeadScoutSaveDialog
        candidate={candidate}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole("form", { name: "Create Scout profile" })).toBeTruthy();
    expect(screen.getByText("Scout Profile Draft")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Profile" })).toBeTruthy();
  });
});
