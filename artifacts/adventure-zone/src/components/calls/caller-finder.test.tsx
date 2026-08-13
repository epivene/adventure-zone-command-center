import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("@/lib/auth-token", () => ({ apiGet }));

import { CallerFinder } from "./caller-finder";

const exactContactId = "11111111-1111-4111-8111-111111111111";
const sarahId = "22222222-2222-4222-8222-222222222222";

function result(overrides: Record<string, unknown> = {}) {
  return {
    exact: { kind: "none" },
    suggestions: [],
    canCreate: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
});

describe("CallerFinder", () => {
  it("opens the only exact match without treating area-code suggestions as certain", async () => {
    const onSelect = vi.fn();
    apiGet.mockResolvedValue(result({
      exact: { kind: "one", contactId: exactContactId },
      suggestions: [{
        contactId: sarahId,
        name: "Sarah Miller",
        organizationName: "Prairie Days",
        city: "Minot",
        region: "ND",
        bookingStatus: "interested",
        routeLegName: "North loop",
        lastContactedAt: "2026-08-10T15:00:00.000Z",
        reasons: ["Same area code"],
        score: 50,
      }],
    }));

    render(<CallerFinder initialPhone="7015550199" onSelect={onSelect} />);

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(exactContactId));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("requires a click for area-code suggestions and explains the match", async () => {
    const onSelect = vi.fn();
    apiGet.mockResolvedValue(result({
      suggestions: [{
        contactId: sarahId,
        name: "Sarah Miller",
        organizationName: "Prairie Days",
        city: "Minot",
        region: "ND",
        bookingStatus: "interested",
        routeLegName: "North loop",
        lastContactedAt: "2026-08-10T15:00:00.000Z",
        reasons: ["Location", "Same area code"],
        score: 200,
      }],
    }));

    render(<CallerFinder initialPhone="7015559999" onSelect={onSelect} />);

    expect(await screen.findByText("Possible callers")).toBeVisible();
    expect(screen.getByText("Same area code")).toBeVisible();
    expect(screen.getByText("Location")).toBeVisible();
    expect(screen.getByText("Minot, ND")).toBeVisible();
    expect(screen.getByText(/interested.*North loop/i)).toBeVisible();
    expect(screen.getByText(/Last contacted.*Aug 10, 2026/i)).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {
      name: /Sarah Miller.*Prairie Days/i,
    }));
    expect(onSelect).toHaveBeenCalledWith(sarahId);
  });

  it("does not auto-open ambiguous exact-phone suggestions", async () => {
    const onSelect = vi.fn();
    apiGet.mockResolvedValue(result({
      canCreate: false,
      suggestions: [
        {
          contactId: exactContactId,
          name: "Avery Lee",
          organizationName: "River Fest",
          city: "Fargo",
          region: "ND",
          bookingStatus: null,
          routeLegName: null,
          lastContactedAt: null,
          reasons: ["Exact phone"],
          score: 1000,
        },
        {
          contactId: sarahId,
          name: "Sarah Miller",
          organizationName: "Prairie Days",
          city: "Minot",
          region: "ND",
          bookingStatus: null,
          routeLegName: null,
          lastContactedAt: null,
          reasons: ["Exact phone"],
          score: 1000,
        },
      ],
    }));

    render(<CallerFinder initialPhone="7015550199" onSelect={onSelect} />);

    expect(await screen.findByText("Possible callers")).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Create contact" })).not.toBeInTheDocument();
  });

  it("debounces one unified search input and keeps create available without an exact match", async () => {
    const onSelect = vi.fn();
    apiGet.mockResolvedValue(result());
    render(<CallerFinder onSelect={onSelect} />);

    fireEvent.change(screen.getByLabelText("Find caller"), {
      target: { value: "Prairie Days" },
    });

    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith(
      "/calls/caller-finder?q=Prairie+Days",
    ));
    expect(screen.getByRole("link", { name: "Create contact" })).toHaveAttribute(
      "href",
      "/quick-add?create=1&q=Prairie%20Days",
    );
  });
});
