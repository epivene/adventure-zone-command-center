import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeadLegControls } from "./lead-leg-controls";

const apiPost = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-token", () => ({ apiPost }));
vi.mock("@workspace/avz-crm/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => (
    <select id="selected-lead-leg" value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: any) => children,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

afterEach(() => {
  cleanup();
  apiPost.mockReset();
});

const legs = [
  { id: "leg-north", name: "North route" },
  { id: "leg-south", name: "South route" },
  { id: "leg-archived", name: "Archived route", archivedAt: "2026-01-01" },
];
const assignment = {
  assignedLegId: null,
  suggestedLegId: "leg-north",
  source: "route_score" as const,
  explanation: "Balanced workload and route fit.",
  warning: null,
  confidence: "medium" as const,
};
const alternatives = [
  {
    legId: "leg-north",
    legName: "North route",
    confirmedEventCount: 2,
    priorYearMatch: true,
    eligible: true,
    previousStopDriveMinutes: 45,
    nextStopDriveMinutes: 90,
    routeDriveMinutes: 135,
    warning: null,
    reason: "The confirmed route leaves enough travel and setup time.",
  },
  {
    legId: "leg-south",
    legName: "South route",
    confirmedEventCount: 5,
    priorYearMatch: false,
    eligible: false,
    previousStopDriveMinutes: 240,
    nextStopDriveMinutes: null,
    routeDriveMinutes: 240,
    warning: "long_travel" as const,
    reason: "Not enough time before this event.",
  },
];

describe("LeadLegControls", () => {
  it("lets an owner apply the suggestion or choose a different active leg", async () => {
    const saved = { ...assignment, assignedLegId: "leg-north", source: "manual" as const };
    apiPost.mockResolvedValue({ legAssignment: saved });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<LeadLegControls bookingId="booking-1" assignment={assignment} legs={legs} alternatives={alternatives} onSaved={onSaved} onBusyChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Use suggested leg" })).toBeInTheDocument();
    const comparisons = screen.getByRole("region", { name: "Active leg comparisons" });
    expect(comparisons).toHaveTextContent("2 confirmed events this season");
    expect(comparisons).toHaveTextContent("45 min before, 1.5h after");
    expect(comparisons).toHaveTextContent("Handled last year");
    expect(comparisons).toHaveTextContent("Needs review: Not enough time before this event.");
    expect(screen.queryByRole("option", { name: "Archived route" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Or choose another active leg"), { target: { value: "leg-south" } });
    fireEvent.click(screen.getByRole("button", { name: "Save chosen leg" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/bookings/booking-1/lead-leg", {
      travelLegId: "leg-south",
      expectedTravelLegId: null,
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Leg assignment saved.");
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it("allows a manual choice when no safe suggestion was produced", async () => {
    const saved = { ...assignment, assignedLegId: "leg-south", suggestedLegId: "leg-south", source: "manual" as const };
    apiPost.mockResolvedValue({ legAssignment: saved });
    render(<LeadLegControls bookingId="booking-2" assignment={null} legs={legs} onSaved={vi.fn().mockResolvedValue(undefined)} onBusyChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Or choose another active leg"), { target: { value: "leg-south" } });
    fireEvent.click(screen.getByRole("button", { name: "Save chosen leg" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/bookings/booking-2/lead-leg", {
      travelLegId: "leg-south",
      expectedTravelLegId: null,
    }));
  });
});
