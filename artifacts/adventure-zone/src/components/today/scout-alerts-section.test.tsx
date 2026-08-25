import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScoutAlertsSection, type ScoutAlertView } from "./scout-alerts-section";

function alert(overrides: Partial<ScoutAlertView> = {}): ScoutAlertView {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    organizationId: "10000000-0000-4000-8000-000000000001",
    bookingId: "20000000-0000-4000-8000-000000000001",
    profileName: "Twin Falls County Fair",
    kind: "deadline_approaching",
    severity: "urgent",
    title: "Application deadline within 7 days",
    body: "The vendor application closes soon.",
    beforeValue: null,
    afterValue: { deadline: "2026-08-31", thresholdDays: 7 },
    sources: [{
      url: "https://example.org/vendors",
      title: "Official vendor application",
      publisher: "Twin Falls County Fair",
      category: "vendor_application",
      retrievedAt: "2026-08-25T12:00:00.000Z",
    }],
    confidence: "high",
    dueAt: "2026-08-31T23:59:59.999Z",
    detectedAt: "2026-08-25T12:00:00.000Z",
    ...overrides,
  };
}

describe("ScoutAlertsSection", () => {
  it("renders nothing when Scout has no visible alerts", () => {
    const view = render(
      <ScoutAlertsSection alerts={[]} urgentCount={0} onSnooze={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(view.container).toBeEmptyDOMElement();
  });

  it("shows urgent count, profile, deadline, before/after details, and public source", () => {
    render(
      <ScoutAlertsSection
        alerts={[alert({ beforeValue: { deadline: "2026-09-15" } })]}
        urgentCount={1}
        onSnooze={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText("Scout Alerts")).toBeTruthy();
    expect(screen.getByText("1 urgent")).toBeTruthy();
    expect(screen.getByText("Twin Falls County Fair")).toBeTruthy();
    expect(screen.getByText("Application deadline within 7 days")).toBeTruthy();
    expect(screen.getByText(/Before:/)).toBeTruthy();
    expect(screen.getByText(/Now:/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Official vendor application" })).toHaveAttribute("href", "https://example.org/vendors");
    expect(screen.getByRole("link", { name: "Open profile" })).toHaveAttribute(
      "href",
      "/profiles/10000000-0000-4000-8000-000000000001?bookingId=20000000-0000-4000-8000-000000000001",
    );
    expect(screen.getByText("Scout Alerts").closest("details")).toHaveAttribute("open");
  });

  it("keeps nonurgent alerts collapsed by default", () => {
    render(
      <ScoutAlertsSection
        alerts={[alert({ severity: "info" })]}
        urgentCount={0}
        onSnooze={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Scout Alerts").closest("details")).not.toHaveAttribute("open");
  });

  it("invokes Snooze and Dismiss callbacks", async () => {
    const onSnooze = vi.fn(async () => undefined);
    const onDismiss = vi.fn(async () => undefined);
    render(
      <ScoutAlertsSection alerts={[alert()]} urgentCount={1} onSnooze={onSnooze} onDismiss={onDismiss} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Snooze 1 week" }));
    await waitFor(() => expect(onSnooze).toHaveBeenCalledWith("50000000-0000-4000-8000-000000000001"));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith("50000000-0000-4000-8000-000000000001"));
  });

  it("leaves the alert visible and reports an action failure", async () => {
    const onSnooze = vi.fn(async () => { throw new Error("Could not snooze this Scout Alert."); });
    render(
      <ScoutAlertsSection alerts={[alert()]} urgentCount={1} onSnooze={onSnooze} onDismiss={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Snooze 1 week" }));
    await screen.findByRole("alert");
    expect(screen.getByText("Could not snooze this Scout Alert.")).toBeTruthy();
    expect(screen.getByText("Twin Falls County Fair")).toBeTruthy();
  });
});
