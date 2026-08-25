import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const profileResponse = {
  kind: "profile_results" as const,
  text: "I found 1 matching profile.",
  results: [{
    id: "00000000-0000-4000-8000-000000000001",
    kind: "organization" as const,
    label: "Morton County Fair",
    secondaryLabel: null,
    city: "Mandan",
    region: "ND",
    status: "possible",
    lastContactAt: null,
    bookingCount: 4,
    matchedOn: ["name"],
  }],
};

vi.mock("@/features/assistant/assistant-api", () => ({
  askGeneralAssistant: vi.fn(async () => profileResponse),
  askBookingAssistant: vi.fn(),
  getLatestAssistantConversation: vi.fn(),
  loadAssistantSnapshot: vi.fn(),
}));

vi.mock("@/features/assistant/lead-scout-api", () => ({
  getLatestLeadScoutRun: vi.fn(async () => null),
  getLeadScoutRun: vi.fn(),
  startLeadScout: vi.fn(),
  stopLeadScout: vi.fn(),
  continueLeadScout: vi.fn(),
  deepenLeadScoutCandidate: vi.fn(),
  dismissLeadScoutCandidate: vi.fn(),
  saveLeadScoutCandidate: vi.fn(),
}));

import { askGeneralAssistant } from "@/features/assistant/assistant-api";
import {
  continueLeadScout,
  deepenLeadScoutCandidate,
  dismissLeadScoutCandidate,
  getLatestLeadScoutRun,
  getLeadScoutRun,
  saveLeadScoutCandidate,
  startLeadScout,
  stopLeadScout,
} from "@/features/assistant/lead-scout-api";
import { AssistantContextProvider, useAssistantContext } from "@/features/assistant/assistant-context";
import { AssistantDrawer } from "./assistant-drawer";

function OpenAssistant() {
  const { openAssistant } = useAssistantContext();
  return <button onClick={() => openAssistant()}>open</button>;
}

const leadRun = {
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
  crmMatches: [{
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
  }],
  candidates: [],
  sources: [],
  startedAt: "2026-08-19T12:00:00.000Z",
  completedAt: null,
  createdAt: "2026-08-19T12:00:00.000Z",
  updatedAt: "2026-08-19T12:00:00.000Z",
  failureMessage: null,
} as const;

const runningRun = {
  ...leadRun,
  status: "running" as const,
  stage: "candidate_enrichment" as const,
  progress: { label: "Researching candidate details", sourcesChecked: 12, candidatesFound: 1, candidatesEnriched: 0, candidatesCompared: 1 },
  candidates: [{
    id: "40000000-0000-4000-8000-000000000001",
    name: "Silver Valley Days",
    city: "Kellogg",
    region: "ID",
    venue: "Downtown",
    startsAt: "2026-09-11",
    endsAt: "2026-09-13",
    organizerName: null,
    organizerEmail: null,
    organizerPhone: null,
    website: "https://example.org/silver-valley",
    eventType: "community festival",
    recurrenceSummary: null,
    attendanceSummary: null,
    vendorSummary: null,
    applicationDeadline: null,
    fitScore: null,
    fitRationale: "Family community event on the requested corridor.",
    fitReasons: [],
    fitCautions: [],
    crmMatchStatus: "new_prospect" as const,
    matchedOrganizationId: null,
    matchedBookingId: null,
    reviewStatus: "unreviewed" as const,
    enrichmentStatus: "needs_enrichment" as const,
    coverageGaps: [],
    enrichmentError: null,
    enrichedAt: null,
    deepenRequestedAt: null,
    savedOrganizationId: null,
    savedBookingId: null,
    facts: [],
  }],
};

const stoppedRun = {
  ...runningRun,
  status: "stopped" as const,
  progress: { ...runningRun.progress, label: "Search stopped — partial results" },
};

const completedRun = {
  ...runningRun,
  status: "complete" as const,
  stage: "complete" as const,
  completedAt: "2026-08-19T18:30:00.000Z",
  progress: { ...runningRun.progress, label: "Search complete", candidatesEnriched: 1 },
};

const savedRun = {
  ...completedRun,
  candidates: completedRun.candidates.map((candidate) => ({
    ...candidate,
    crmMatchStatus: "existing" as const,
    matchedOrganizationId: "profile-1",
    matchedBookingId: "booking-1",
    reviewStatus: "saved" as const,
    savedOrganizationId: "profile-1",
    savedBookingId: "booking-1",
  })),
};

const deepeningRun = {
  ...runningRun,
  candidates: runningRun.candidates.map((candidate) => ({
    ...candidate,
    enrichmentStatus: "enriching" as const,
    deepenRequestedAt: "2026-08-19T18:20:00.000Z",
  })),
};

const dismissedRun = {
  ...completedRun,
  candidates: completedRun.candidates.map((candidate) => ({ ...candidate, reviewStatus: "dismissed" as const })),
};

describe("AssistantDrawer general mode", () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    vi.mocked(askGeneralAssistant).mockReset();
    vi.mocked(askGeneralAssistant).mockResolvedValue(profileResponse);
    vi.mocked(getLatestLeadScoutRun).mockReset();
    vi.mocked(getLatestLeadScoutRun).mockResolvedValue(null);
    vi.mocked(getLeadScoutRun).mockReset();
    vi.mocked(startLeadScout).mockReset();
    vi.mocked(stopLeadScout).mockReset();
    vi.mocked(continueLeadScout).mockReset();
    vi.mocked(deepenLeadScoutCandidate).mockReset();
    vi.mocked(dismissLeadScoutCandidate).mockReset();
    vi.mocked(saveLeadScoutCandidate).mockReset();
  });

  it("keeps the assistant usable with no profile open and suggests supported searches", () => {
    render(<AssistantContextProvider><OpenAssistant /><AssistantDrawer /></AssistantContextProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByText("General Command Center")).toBeTruthy();
    expect(screen.getByLabelText("Ask Booking Assistant")).not.toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Find Christmas events" })).toBeTruthy();
  });

  it("renders structured profile results from general search", async () => {
    render(<AssistantContextProvider><OpenAssistant /><AssistantDrawer /></AssistantContextProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.change(screen.getByLabelText("Ask Booking Assistant"), { target: { value: "Find Morton County Fair" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("Morton County Fair")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Use as context" })).toBeTruthy();
  });

  it("renders CRM-first discovery with Start Scout Search enabled", async () => {
    vi.mocked(askGeneralAssistant).mockResolvedValueOnce({ kind: "lead_discovery", text: "I found 1 existing Command Center possibility.", run: leadRun as any });
    render(<AssistantContextProvider><OpenAssistant /><AssistantDrawer /></AssistantContextProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.change(screen.getByLabelText("Ask Booking Assistant"), { target: { value: leadRun.originalQuestion } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("Montana September Fair")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Start Scout Search" })).not.toHaveProperty("disabled", true);
  });

  it("restores the latest Lead Scout run when General Command Center reopens", async () => {
    vi.mocked(getLatestLeadScoutRun).mockResolvedValueOnce(leadRun as any);
    render(<AssistantContextProvider><OpenAssistant /><AssistantDrawer /></AssistantContextProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(screen.getByText("Montana September Fair")).toBeTruthy());
    expect(getLatestLeadScoutRun).toHaveBeenCalledTimes(1);
  });

  it("starts Scout Search with preserved criteria and renders temporary results", async () => {
    vi.mocked(getLatestLeadScoutRun).mockResolvedValueOnce(leadRun as any);
    vi.mocked(startLeadScout).mockResolvedValueOnce(runningRun as any);
    render(<AssistantContextProvider><OpenAssistant /><AssistantDrawer /></AssistantContextProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start Scout Search" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Start Scout Search" }));
    await waitFor(() => expect(screen.getByText("Silver Valley Days")).toBeTruthy());
    expect(startLeadScout).toHaveBeenCalledWith(leadRun.id);
    expect(screen.getByText("Found")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not a fit" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Create Profile" })).toHaveProperty("disabled", true);
  });

  it("queues Research deeper for one prospect and resumes run polling state", async () => {
    vi.mocked(getLatestLeadScoutRun).mockResolvedValueOnce(completedRun as any);
    vi.mocked(deepenLeadScoutCandidate).mockResolvedValueOnce(deepeningRun as any);
    render(<AssistantContextProvider><OpenAssistant /><AssistantDrawer /></AssistantContextProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(screen.getByText("Silver Valley Days")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Research deeper" }));
    await waitFor(() => expect(deepenLeadScoutCandidate).toHaveBeenCalledWith(leadRun.id, runningRun.candidates[0].id));
    await waitFor(() => expect(screen.getByRole("button", { name: "Researching deeper…" })).toHaveProperty("disabled", true));
  });

  it("creates a profile from a completed Scout result and links it to Command Center", async () => {
    vi.mocked(getLatestLeadScoutRun).mockResolvedValueOnce(completedRun as any);
    vi.mocked(saveLeadScoutCandidate).mockResolvedValueOnce({
      kind: "created",
      profileId: "profile-1",
      bookingId: "booking-1",
      run: savedRun as any,
    });
    render(<AssistantContextProvider><OpenAssistant /><AssistantDrawer /></AssistantContextProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create Profile" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Create Profile" }));

    const dialog = await screen.findByRole("form", { name: "Create Scout profile" });
    fireEvent.change(within(dialog).getByLabelText("First action"), { target: { value: "call" } });
    fireEvent.change(within(dialog).getByLabelText("First follow-up date"), { target: { value: "2026-08-24" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Profile" }));

    await waitFor(() => expect(saveLeadScoutCandidate).toHaveBeenCalledWith(
      leadRun.id,
      runningRun.candidates[0].id,
      expect.objectContaining({
        accepted: expect.objectContaining({
          name: "Silver Valley Days",
          city: "Kellogg",
          region: "ID",
          website: "https://example.org/silver-valley",
        }),
        nextActionKind: "call",
        nextActionDueAt: "2026-08-24",
      }),
    ));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Create Scout profile" })).toBeNull());
    expect(screen.getByText("In Command Center")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open profile" })).toHaveAttribute("href", "/profiles/profile-1");
  });

  it("marks a completed Scout prospect Not a fit and removes it from the review list", async () => {
    vi.mocked(getLatestLeadScoutRun).mockResolvedValueOnce(completedRun as any);
    vi.mocked(dismissLeadScoutCandidate).mockResolvedValueOnce(dismissedRun as any);
    render(<AssistantContextProvider><OpenAssistant /><AssistantDrawer /></AssistantContextProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(screen.getByText("Silver Valley Days")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Not a fit" }));
    await waitFor(() => expect(dismissLeadScoutCandidate).toHaveBeenCalledWith(leadRun.id, runningRun.candidates[0].id));
    await waitFor(() => expect(screen.queryByText("Silver Valley Days")).toBeNull());
    expect(screen.getByText(/No Scout Results remain/i)).toBeTruthy();
  });

  it("stops and continues a Scout run without losing partial prospects", async () => {
    vi.mocked(getLatestLeadScoutRun).mockResolvedValueOnce(runningRun as any);
    vi.mocked(stopLeadScout).mockResolvedValueOnce(stoppedRun as any);
    vi.mocked(continueLeadScout).mockResolvedValueOnce(runningRun as any);
    render(<AssistantContextProvider><OpenAssistant /><AssistantDrawer /></AssistantContextProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop search" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Stop search" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue search" })).toBeTruthy());
    expect(screen.getByText("Silver Valley Days")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue search" }));
    await waitFor(() => expect(continueLeadScout).toHaveBeenCalledWith(runningRun.id));
  });

  it("closing the drawer does not stop a running Scout", async () => {
    vi.mocked(getLatestLeadScoutRun).mockResolvedValueOnce(runningRun as any);
    render(<AssistantContextProvider><OpenAssistant /><AssistantDrawer /></AssistantContextProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(screen.getByText("Silver Valley Days")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close Booking Assistant" }));
    expect(stopLeadScout).not.toHaveBeenCalled();
  });
});
