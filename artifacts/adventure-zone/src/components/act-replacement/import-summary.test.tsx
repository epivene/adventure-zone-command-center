import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ImportSummary } from "./import-summary";

afterEach(cleanup);

describe("ImportSummary", () => {
  it("shows safe outcome totals and review work that remains", () => {
    render(
      <ImportSummary
        applied={18}
        alreadyPresent={4}
        blocked={2}
        failed={1}
        remainingReview={3}
      />,
    );

    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("Applied")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Already present")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("3 records still need review")).toBeInTheDocument();
  });
});
