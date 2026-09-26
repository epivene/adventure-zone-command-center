import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsageCostSummary } from "./UsageCost";

const measured = {
  currency: "USD" as const,
  estimatedUsd: 0.0062,
  status: "complete" as const,
  pricedCalls: 2,
  unpricedCalls: 0,
  pricingVersions: ["2026-09-25"],
  excluded: [],
};

describe("assistant cost display", () => {
  it("shows measured sub-cent charges separately for the reply and conversation", () => {
    render(
      <UsageCostSummary
        latest={measured}
        conversation={{ ...measured, estimatedUsd: 0.024 }}
      />,
    );
    expect(screen.getByText(/Latest reply: \$0.0062/)).toBeInTheDocument();
    expect(screen.getByText(/Conversation: \$0.0240/)).toBeInTheDocument();
    expect(screen.getByText(/Estimated AI cost/)).toBeInTheDocument();
    expect(
      screen.getByText(/OpenAI billing is authoritative/),
    ).toBeInTheDocument();
  });

  it("identifies partial costs and excluded charges", () => {
    render(
      <UsageCostSummary
        latest={measured}
        conversation={{
          ...measured,
          status: "partial",
          excluded: ["Web search tool fees are excluded."],
        }}
      />,
    );
    expect(
      screen.getByText(/Conversation: \$0.0062 \(partial\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Web search tool fees are excluded."),
    ).toBeInTheDocument();
  });

  it("never represents historical or unpriced usage as a zero-dollar bill", () => {
    render(
      <UsageCostSummary
        conversation={{
          ...measured,
          status: "unavailable",
          estimatedUsd: null,
          pricedCalls: 0,
          unpricedCalls: 1,
        }}
      />,
    );
    expect(screen.getByText(/Conversation: unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Latest reply: unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Older runs may not include cost measurements/),
    ).toBeInTheDocument();
  });

  it("keeps tiny positive estimates distinct from measured zero", () => {
    render(
      <UsageCostSummary
        latest={{ ...measured, estimatedUsd: 0.000001 }}
        conversation={{ ...measured, status: "partial", estimatedUsd: 0.00001 }}
      />,
    );
    expect(screen.getByText("Latest reply: <$0.0001")).toBeInTheDocument();
    expect(
      screen.getByText("Conversation: <$0.0001 (partial)"),
    ).toBeInTheDocument();
  });

  it("can display a measured zero without claiming unknown usage is free", () => {
    render(<UsageCostSummary latest={{ ...measured, estimatedUsd: 0 }} />);
    expect(screen.getByText(/Latest reply: \$0.0000/)).toBeInTheDocument();
    expect(screen.getByText(/Conversation: unavailable/)).toBeInTheDocument();
  });
});
