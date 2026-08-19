import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
}));

import { askGeneralAssistant } from "@/features/assistant/assistant-api";
import {
  continueLeadScout,
  getLatestLeadScoutRun,
  getLeadScoutRun,
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
  stage: "candidate_discovery" as const,
  progress: { label: "Checking candidate events", sourcesChecked: 12, candidatesFound: 1, candidatesEnriched: 0, candidatesCompared: 0 },
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
    crmMatchStatus: "new_prospect" as const,
    matchedOrganizationId: null,
    matchedBookingId: null,
    reviewStatus: "unreviewed" as const,
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
  });

  it("keeps the assistant usable with no profile open and suggests supported searches", () => {
    render(
      <AssistantContextProvider>
        <OpenAssistant />
        <AssistantDrawer />
      </AssistantContextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByText("General Command Center")).toBeTruthy();
    expect(screen.getByLabelText("Ask Booking Assistant")).not.toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Find Christmas events" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Who usually books Pirate's Rebellion?" })).toBeNull();
  });

  it("renders structured profile results from general search", async () => {
    render(
      <AssistantContextProvider>
        <OpenAssistant />
        <AssistantDrawer />
      </AssistantContextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.change(screen.getByLabelText("Ask Booking Assistant"), { target: { value: "Find Morton County Fair" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("Morton County Fair")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Use as context" })).toBeTruthy();
  });

  it("renders CRM-first lead discovery with Find me new leads enabled", async () => {
    vi.mocked(askGeneralAssistant).mockResolvedValueOnce({
      kind: "lead_discovery",
      text: "I found 1 existing Command Center possibility.",
      run: leadRun as any,
    });

    render(
      <AssistantContextProvider>
        <OpenAssistant />
        <AssistantDrawer />
      </AssistantContextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.change(screen.getByLabelText("Ask Booking Assistant"), { target: { value: leadRun.originalQuestion } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(screen.getByText("Montana September Fair")).toBeTruthy());
    expect(screen.getByText("Confirmed matches")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find me new leads" })).not.toHaveProperty("disabled", true);
    expect(screen.queryByText("Morton County Fair")).toBeNull();
  });

  it("restores the latest Lead Scout run when General Command Center reopens", async () => {
    vi.mocked(getLatestLeadScoutRun).mockResolvedValueOnce(leadRun as any);

    render(
      <AssistantContextProvider>
        <OpenAssistant />
        <AssistantDrawer />
      </AssistantContextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));

    await waitFor(() => expect(screen.getByText("Montana September Fair")).toBeTruthy());
    expect(getLatestLeadScoutRun).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Find me new leads" })).toBeTruthy();
  });

  it("starts web scouting with preserved criteria and renders partial unsaved prospects", async () => {
    vi.mocked(getLatestLeadScoutRun).mockResolvedValueOnce(leadRun as any);
    vi.mocked(startLeadScout).mockResolvedValueOnce(runningRun as any);

    render(
      <AssistantContextProvider>
        <OpenAssistant />
        <AssistantDrawer />
      </AssistantContextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Find me new leads" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Find me new leads" }));

    await waitFor(() => expect(screen.getByText("Silver Valley Days")).toBeTruthy());
    expect(startLeadScout).toHaveBeenCalledWith(leadRun.id);
    expect(screen.getByText("Unsaved prospect")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop search" })).toBeTruthy();
  });

  it("stops and continues a Scout run without losing partial prospects", async () => {
    vi.mocked(getLatestLeadScoutRun).mockResolvedValueOnce(runningRun as any);
    vi.mocked(stopLeadScout).mockResolvedValueOnce(stoppedRun as any);
    vi.mocked(continueLeadScout).mockResolvedValueOnce(runningRun as any);

    render(
      <AssistantContextProvider>
        <OpenAssistant />
        <AssistantDrawer />
      </AssistantContextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop search" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Stop search" }));

    await waitFor(() => expect(stopLeadScout).toHaveBeenCalledWith(runningRun.id));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue search" })).toBeTruthy());
    expect(screen.getByText("Silver Valley Days")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continue search" }));
    await waitFor(() => expect(continueLeadScout).toHaveBeenCalledWith(runningRun.id));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop search" })).toBeTruthy());
    expect(screen.getByText("Silver Valley Days")).toBeTruthy();
  });

  it("closing the drawer does not stop a running Scout", async () => {
    vi.mocked(getLatestLeadScoutRun).mockResolvedValueOnce(runningRun as any);

    render(
      <AssistantContextProvider>
        <OpenAssistant />
        <AssistantDrawer />
      </AssistantContextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(screen.getByText("Silver Valley Days")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close Booking Assistant" }));

    expect(stopLeadScout).not.toHaveBeenCalled();
  });
});
