import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleScopePreview } from "./google-scope-preview";

const preview = {
  labels: [
    { id: "shows", name: "Shows", rootId: "shows", rootName: "Shows" },
    {
      id: "shows-2026",
      name: "Shows/2026",
      rootId: "shows",
      rootName: "Shows",
    },
    {
      id: "receipts",
      name: "Receipts",
      rootId: "receipts",
      rootName: "Receipts",
    },
  ],
  calendars: [
    { id: "az", summary: "Adventure Zone Calendar", primary: false },
    {
      id: "zone.pirate.warrior@gmail.com",
      summary: "Zone Pirate Warrior",
      primary: true,
    },
  ],
  missingLabelRoots: ["Associations"],
  missingCalendars: ["Warriors Playground Calendar"],
  excludedLabelCount: 8,
  excludedCalendarCount: 2,
};

afterEach(cleanup);

describe("GoogleScopePreview", () => {
  it("shows recommended business labels, calendars, missing sources, and exclusions", () => {
    render(
      <GoogleScopePreview
        preview={preview}
        selectedLabelIds={["shows", "shows-2026", "receipts"]}
        selectedCalendarIds={["az", "zone.pirate.warrior@gmail.com"]}
        onLabelChange={() => undefined}
        onCalendarChange={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "Gmail labels" })).toBeInTheDocument();
    expect(screen.getByLabelText("Shows")).toBeChecked();
    expect(screen.getByLabelText("Shows/2026")).toBeChecked();
    expect(screen.getByLabelText("Receipts")).toBeChecked();
    expect(screen.getByRole("heading", { name: "Google Calendars" })).toBeInTheDocument();
    expect(screen.getByLabelText("Adventure Zone Calendar")).toBeChecked();
    expect(screen.getByLabelText("Zone Pirate Warrior")).toBeChecked();
    expect(screen.getByText("Associations")).toBeInTheDocument();
    expect(screen.getByText("Warriors Playground Calendar")).toBeInTheDocument();
    expect(screen.getByText("8 other Gmail labels not selected")).toBeInTheDocument();
    expect(screen.getByText("2 calendars excluded")).toBeInTheDocument();

    const warning = screen
      .getByText("Expected business labels not found")
      .closest("div");
    expect(warning?.className).toContain("dark:bg-amber-950/40");
    expect(warning?.className).toContain("dark:border-amber-900");
  });

  it("reports exact checkbox changes by Google ID", () => {
    const onLabelChange = vi.fn();
    const onCalendarChange = vi.fn();
    render(
      <GoogleScopePreview
        preview={preview}
        selectedLabelIds={["shows"]}
        selectedCalendarIds={["az"]}
        onLabelChange={onLabelChange}
        onCalendarChange={onCalendarChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("Shows/2026"));
    fireEvent.click(screen.getByLabelText("Adventure Zone Calendar"));

    expect(onLabelChange).toHaveBeenCalledWith("shows-2026", true);
    expect(onCalendarChange).toHaveBeenCalledWith("az", false);
  });
});
