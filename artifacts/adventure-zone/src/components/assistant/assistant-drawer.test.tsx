import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/assistant/assistant-api", () => ({
  askGeneralAssistant: vi.fn(async () => ({
    kind: "profile_results",
    text: "I found 1 matching profile.",
    results: [{
      id: "00000000-0000-4000-8000-000000000001",
      kind: "organization",
      label: "Morton County Fair",
      secondaryLabel: null,
      city: "Mandan",
      region: "ND",
      status: "possible",
      lastContactAt: null,
      bookingCount: 4,
      matchedOn: ["name"],
    }],
  })),
  askBookingAssistant: vi.fn(),
  getLatestAssistantConversation: vi.fn(),
  loadAssistantSnapshot: vi.fn(),
}));

import { askGeneralAssistant } from "@/features/assistant/assistant-api";
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

describe("AssistantDrawer general mode", () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
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

  it("renders CRM-first lead discovery separately from simple profile search", async () => {
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
    expect(screen.getByRole("button", { name: "Find me new leads" })).toHaveProperty("disabled", true);
    expect(screen.queryByText("Morton County Fair")).toBeNull();
  });
});
