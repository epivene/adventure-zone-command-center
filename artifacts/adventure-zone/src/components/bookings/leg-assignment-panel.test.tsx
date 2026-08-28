// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LegAssignmentPanel } from "./leg-assignment-panel";

const legs = [
  { id: "leg-kristy", name: "Kristy" },
  { id: "leg-hulk", name: "Hulk" },
];

describe("LegAssignmentPanel", () => {
  it("shows a prior-year assignment and its reason", () => {
    render(<LegAssignmentPanel assignment={{
      assignedLegId: "leg-kristy",
      suggestedLegId: "leg-kristy",
      source: "prior_year",
      explanation: "Handled this event last year.",
      warning: null,
      confidence: "high",
    }} travelLegs={legs} />);
    expect(screen.getByText("Assigned: Kristy")).toBeInTheDocument();
    expect(screen.getByText("Last year's leg")).toBeInTheDocument();
    expect(screen.getByText(/Handled this event last year/)).toBeInTheDocument();
  });

  it("shows a long-travel warning on a suggestion", () => {
    render(<LegAssignmentPanel assignment={{
      assignedLegId: null,
      suggestedLegId: "leg-hulk",
      source: "route_score",
      explanation: "Balanced workload first, then route fit.",
      warning: "long_travel",
      confidence: "medium",
    }} travelLegs={legs} />);
    expect(screen.getByText("Suggested: Hulk")).toBeInTheDocument();
    expect(screen.getByText("Long travel")).toBeInTheDocument();
  });

  it("shows needs leg assignment when no suggestion is safe", () => {
    render(<LegAssignmentPanel assignment={{
      assignedLegId: null,
      suggestedLegId: null,
      source: "needs_review",
      explanation: "Choose the leg manually.",
      warning: null,
      confidence: "low",
    }} travelLegs={legs} />);
    expect(screen.getByText("Needs leg assignment")).toBeInTheDocument();
  });
});
