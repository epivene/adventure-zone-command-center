// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResponsiveDetailSheet } from "./responsive-detail-sheet";

describe("ResponsiveDetailSheet", () => {
  it("renders a persistent inline detail region for the desktop split view", () => {
    render(
      <ResponsiveDetailSheet
        fullPageHref="/profiles/profile-1"
        onOpenChange={vi.fn()}
        open
        title="Prairie Days"
        variant="inline"
      >
        <p>Booking details</p>
      </ResponsiveDetailSheet>,
    );

    expect(screen.getByTestId("inline-profile-detail")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Prairie Days" })).toBeVisible();
    expect(screen.getByText("Booking details")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
