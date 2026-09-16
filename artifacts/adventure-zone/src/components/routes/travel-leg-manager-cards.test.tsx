import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { YearEndInspectionLegSummary } from "./travel-leg-manager-cards";

describe("YearEndInspectionLegSummary", () => {
  it("shows inspection progress and repair attention", () => {
    render(<YearEndInspectionLegSummary summary={{ inspected: 42, total: 58, needsAttention: 6, status: "in_progress" }} />);
    expect(screen.getByText("42 of 58 inspected")).toBeVisible();
    expect(screen.getByText("6 need repair")).toBeVisible();
  });
});
