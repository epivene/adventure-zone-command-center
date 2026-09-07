// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/routes/event-map", () => ({
  EventMap: ({ events, readOnly }: {
    events: Array<Record<string, unknown>>;
    readOnly?: boolean;
  }) => (
    <output data-testid="boss-route-event-handoff">
      {JSON.stringify({ events, readOnly })}
    </output>
  ),
}));

import BossSchedulePage from "@/pages/BossSchedulePage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Boss route event handoff", () => {
  it("preserves Admin mapping and suggested-leg metadata while enforcing read-only mode", async () => {
    const currentYear = new Date().getFullYear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      legs: [{
        id: "leg-hulk",
        name: "Hulk",
        color: "#2563eb",
        sortOrder: 2,
        archivedAt: null,
      }],
      bookings: [{
        id: "booking-potential",
        name: "Potential County Fair",
        city: "Logan",
        region: "UT",
        latitude: 41.73698,
        longitude: -111.83384,
        startsAt: `${currentYear}-09-18T12:00:00.000Z`,
        endsAt: `${currentYear}-09-20T12:00:00.000Z`,
        status: "possible",
        probability: "possible",
        travelLegId: "leg-hulk",
        travelLegName: "Hulk",
        travelLegColor: "#2563eb",
        travelLegAssignmentKind: "suggested",
        legAssignmentWarning: "long_travel",
        legAssignmentExplanation: "Fits between the confirmed Hulk stops.",
        routeBucket: "potential",
        locationQuality: "city",
        locationLabel: "Logan, UT",
        mappingState: "mapped_city",
        seasonYear: currentYear,
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<BossSchedulePage />);
    await screen.findByRole("heading", { name: "Schedule", level: 1 });
    screen.getByRole("button", { name: "Map" }).click();

    const handoff = await screen.findByTestId("boss-route-event-handoff");
    expect(handoff).toHaveTextContent('"readOnly":true');
    expect(handoff).toHaveTextContent('"travelLegAssignmentKind":"suggested"');
    expect(handoff).toHaveTextContent('"legAssignmentWarning":"long_travel"');
    expect(handoff).toHaveTextContent('"legAssignmentExplanation":"Fits between the confirmed Hulk stops."');
    expect(handoff).toHaveTextContent('"routeBucket":"potential"');
    expect(handoff).toHaveTextContent('"locationQuality":"city"');
    expect(handoff).toHaveTextContent('"locationLabel":"Logan, UT"');
    expect(handoff).toHaveTextContent('"mappingState":"mapped_city"');
    expect(handoff).toHaveTextContent(`"seasonYear":${currentYear}`);
  });
});
