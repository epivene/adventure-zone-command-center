import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LeadScoutRunView } from "@/features/assistant/assistant-types";
import { LeadDiscoveryResults } from "./lead-discovery-results";

const run: LeadScoutRunView = {
  id: "30000000-0000-4000-8000-000000000001",
  originalQuestion: "I need to find an event between Montana and Utah in September 2026",
  criteria: {
    originalQuestion: "I need to find an event between Montana and Utah in September 2026",
    dateFrom: "2026-09-01",
    dateThrough: "2026-09-30",
    month: 9,
    year: 2026,
    regions: ["MT", "ID", "WY", "UT"],
    cities: [],
    geoMode: "corridor",
    routeId: null,
    legId: null,
    eventKeywords: [],
    fitIntent: "either",
  },
  criteriaSummary: "September 1–30, 2026 · Montana-to-Utah corridor · bookable or vendor opportunities",
  status: "crm_ready",
  stage: "crm_search",
  progress: { label: "Waiting for web-search approval", sourcesChecked: 0, candidatesFound: 0, candidatesEnriched: 0, candidatesCompared: 0 },
  crmMatches: [
    {
      organizationId: "10000000-0000-4000-8000-000000000001",
      bookingId: "20000000-0000-4000-8000-000000000001",
      label: "Montana September Fair",
      city: "Billings",
      region: "MT",
      dateFrom: "2026-09-10",
      dateThrough: "2026-09-12",
      dateConfidence: "confirmed",
      status: "possible",
      relationshipSummary: "1 booking on record",
      reasons: ["Confirmed September date", "On requested corridor"],
      fitScore: 1150,
    },
    {
      organizationId: "10000000-0000-4000-8000-000000000002",
      bookingId: "20000000-0000-4000-8000-000000000003",
      label: "Idaho Harvest Festival",
      city: "Idaho Falls",
      region: "ID",
      dateFrom: null,
      dateThrough: null,
      dateConfidence: "likely_recurring",
      status: "confirmed",
      relationshipSummary: "2 prior bookings on record",
      reasons: ["Usually occurs in September", "On requested corridor", "Past Adventure Zone customer"],
      fitScore: 930,
    },
    {
      organizationId: "10000000-0000-4000-8000-000000000003",
      bookingId: null,
      label: "Utah Family Celebration",
      city: "Ogden",
      region: "UT",
      dateFrom: null,
      dateThrough: null,
      dateConfidence: "unknown",
      status: null,
      relationshipSummary: null,
      reasons: ["On requested corridor"],
      fitScore: 400,
    },
  ],
  candidates: [],
  sources: [],
  startedAt: "2026-08-19T12:00:00.000Z",
  completedAt: null,
  createdAt: "2026-08-19T12:00:00.000Z",
  updatedAt: "2026-08-19T12:00:00.000Z",
  failureMessage: null,
};

describe("LeadDiscoveryResults", () => {
  it("separates confirmed, likely recurring, and broader CRM possibilities", () => {
    render(
      <LeadDiscoveryResults
        run={run}
        webScoutAvailable={false}
        onOpenProfile={vi.fn()}
        onUseContext={vi.fn()}
        onFindNewLeads={vi.fn()}
      />,
    );

    expect(screen.getByText(run.criteriaSummary!)).toBeTruthy();
    expect(screen.getByText("Confirmed matches")).toBeTruthy();
    expect(screen.getByText("Likely recurring")).toBeTruthy();
    expect(screen.getByText("Other useful matches")).toBeTruthy();
    expect(screen.getByText("Montana September Fair")).toBeTruthy();
    expect(screen.getByText("Idaho Harvest Festival")).toBeTruthy();
    expect(screen.getByText("Utah Family Celebration")).toBeTruthy();
    expect(screen.getByText("Date not confirmed for 2026")).toBeTruthy();
    expect(screen.getByText("Usually occurs in September")).toBeTruthy();
  });

  it("does not expose an enabled Scout Search action before Release 2", () => {
    render(
      <LeadDiscoveryResults
        run={run}
        webScoutAvailable={false}
        onOpenProfile={vi.fn()}
        onUseContext={vi.fn()}
        onFindNewLeads={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Start Scout Search" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/Scout Search is not enabled yet/i)).toBeTruthy();
  });

  it("calls the existing profile/context actions for CRM matches", () => {
    const onOpenProfile = vi.fn();
    const onUseContext = vi.fn();
    render(
      <LeadDiscoveryResults
        run={{ ...run, crmMatches: [run.crmMatches[0]!] }}
        webScoutAvailable={false}
        onOpenProfile={onOpenProfile}
        onUseContext={onUseContext}
        onFindNewLeads={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Use as context" }));
    expect(onOpenProfile).toHaveBeenCalledWith(run.crmMatches[0]);
    expect(onUseContext).toHaveBeenCalledWith(run.crmMatches[0]);
  });
});
