import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/assistant/assistant-api", () => ({
  askGeneralAssistant: vi.fn(),
  askBookingAssistant: vi.fn(),
  getLatestAssistantConversation: vi.fn(),
  loadAssistantSnapshot: vi.fn(),
}));

vi.mock("@/features/assistant/lead-scout-api", () => ({
  getLatestLeadScoutRun: vi.fn(),
  getLeadScoutRun: vi.fn(),
  startLeadScout: vi.fn(),
  stopLeadScout: vi.fn(),
  continueLeadScout: vi.fn(),
  deepenLeadScoutCandidate: vi.fn(),
  dismissLeadScoutCandidate: vi.fn(),
  saveLeadScoutCandidate: vi.fn(),
}));

import { getLatestLeadScoutRun, getLeadScoutRun } from "@/features/assistant/lead-scout-api";
import { AssistantContextProvider, useAssistantContext } from "@/features/assistant/assistant-context";
import { AssistantDrawer } from "./assistant-drawer";

function OpenAssistant() {
  const { openAssistant } = useAssistantContext();
  return <button onClick={() => openAssistant()}>open</button>;
}

const runningRun = {
  id: "30000000-0000-4000-8000-000000000001",
  originalQuestion: "Find family events in Idaho in September 2026",
  criteria: null,
  criteriaSummary: "Idaho · September 2026",
  status: "running" as const,
  stage: "source_discovery" as const,
  progress: { label: "Finding public event sources", sourcesChecked: 2, candidatesFound: 0, candidatesEnriched: 0, candidatesCompared: 0 },
  crmMatches: [],
  candidates: [],
  sources: [],
  startedAt: "2026-08-19T20:00:00.000Z",
  completedAt: null,
  createdAt: "2026-08-19T20:00:00.000Z",
  updatedAt: "2026-08-19T20:00:00.000Z",
  failureMessage: null,
};

const completedRun = {
  ...runningRun,
  status: "complete" as const,
  stage: "complete" as const,
  progress: { ...runningRun.progress, label: "Search complete" },
  completedAt: "2026-08-19T20:05:00.000Z",
};

describe("AssistantDrawer Lead Scout polling recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(getLatestLeadScoutRun).mockReset();
    vi.mocked(getLeadScoutRun).mockReset();
  });

  it("shows reconnecting for a transient poll failure and clears it after recovery", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    vi.mocked(getLatestLeadScoutRun).mockResolvedValue(runningRun as never);
    vi.mocked(getLeadScoutRun)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(completedRun as never);

    render(<AssistantContextProvider><OpenAssistant /><AssistantDrawer /></AssistantContextProvider>);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByText("Reconnecting to Lead Scout…")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.queryByText("Reconnecting to Lead Scout…")).toBeNull();
    expect(screen.getByText("Search complete")).toBeTruthy();
  });
});
