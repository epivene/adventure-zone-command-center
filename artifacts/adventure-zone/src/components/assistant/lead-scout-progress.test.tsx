import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LeadScoutProgress } from "./lead-scout-progress";
import type { LeadScoutRunView } from "@/features/assistant/assistant-types";

function run(status: LeadScoutRunView["status"]): LeadScoutRunView {
  return {
    id: "run-1",
    originalQuestion: "Find events between Montana and Utah in September 2026",
    criteria: null,
    criteriaSummary: "September 2026 · MT to UT",
    status,
    stage: status === "complete" ? "complete" : "candidate_discovery",
    progress: { label: status === "stopping" ? "Stopping…" : "Checking candidate events", sourcesChecked: 12, candidatesFound: 5, candidatesEnriched: 0, candidatesCompared: 2 },
    crmMatches: [], candidates: [], sources: [],
    startedAt: "2026-08-19T18:00:00.000Z", completedAt: null,
    createdAt: "2026-08-19T18:00:00.000Z", updatedAt: "2026-08-19T18:00:00.000Z", failureMessage: null,
  };
}

describe("LeadScoutProgress", () => {
  it("shows live stage counters and Stop search while running", () => {
    const onStop = vi.fn();
    render(<LeadScoutProgress run={run("running")} onStop={onStop} onContinue={vi.fn()} />);
    expect(screen.getByText("Checking candidate events")).toBeTruthy();
    expect(screen.getByText(/12 sources checked/i)).toBeTruthy();
    expect(screen.getByText(/5 candidates found/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop search" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("immediately shows Stopping without another action", () => {
    render(<LeadScoutProgress run={run("stopping")} onStop={vi.fn()} onContinue={vi.fn()} />);
    expect(screen.getByText("Stopping…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop search" })).toBeNull();
  });

  it("keeps partial results resumable after stop", () => {
    const onContinue = vi.fn();
    render(<LeadScoutProgress run={run("stopped")} onStop={vi.fn()} onContinue={onContinue} />);
    expect(screen.getByText(/Search stopped — partial results/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue search" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
