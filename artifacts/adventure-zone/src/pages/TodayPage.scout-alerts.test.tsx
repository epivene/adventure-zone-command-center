// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-token", () => ({ apiGet, apiPost }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

import TodayPage from "./TodayPage";

const scoutAlert = {
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
  sources: [],
  confidence: "high",
  dueAt: "2026-08-31T23:59:59.999Z",
  detectedAt: "2026-08-25T12:00:00.000Z",
};

const decision = {
  id: "30000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000002",
  primaryContactId: null,
  name: "Another Fair",
  status: "new_lead",
  probability: "possible",
  planReason: "needs_action",
  operations: null,
};

function dashboard() {
  return {
    followUpCount: 0,
    newLeadCount: 1,
    contractCount: 1,
    visibleRouteWarningCount: 0,
    nextCall: null,
    followUps: [],
    followUpTotal: 0,
    needsFollowUpPlan: [decision],
    upcomingEvents: [],
    todayTrips: [],
    renewals: [],
    renewalTotal: 0,
    renewalProminentCount: 0,
    renewalError: null,
    scoutAlerts: [scoutAlert],
    scoutAlertTotal: 1,
    scoutUrgentAlertTotal: 1,
  };
}

function mockApi() {
  apiGet.mockImplementation((path: string) => {
    if (path === "/today") return Promise.resolve(dashboard());
    if (path === "/calls/config") return Promise.resolve({ assistedCallingEnabled: false, voicemailLauncherUrl: null });
    return Promise.reject(new Error(`Unexpected API path: ${path}`));
  });
  apiPost.mockResolvedValue({ ok: true });
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPost.mockReset();
});

describe("TodayPage Scout Alerts", () => {
  it("keeps urgent Scout Alerts visible outside collapsed booking tools", async () => {
    mockApi();
    render(<TodayPage />);

    await waitFor(() => expect(screen.getByText("Twin Falls County Fair")).toBeInTheDocument());

    const tools = screen.getByText("Booking tools").closest("details")!;
    const alerts = screen.getByText(/Scout Alerts/).closest("details")!;
    expect(alerts).toHaveAttribute("open");
    expect(tools).not.toContainElement(alerts);
    expect(screen.getByRole("region", { name: "Daily work queue" })).toBeVisible();
    expect(screen.getByText("Twin Falls County Fair")).toBeVisible();
  });

  it("snoozes one alert for one week and removes it from Today after success", async () => {
    mockApi();
    render(<TodayPage />);
    await waitFor(() => expect(screen.getByText("Twin Falls County Fair")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Snooze 1 week" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      "/today/scout-alerts/50000000-0000-4000-8000-000000000001/snooze",
      { until: expect.any(String) },
    ));
    await waitFor(() => expect(screen.queryByText("Twin Falls County Fair")).not.toBeInTheDocument());
  });

  it("dismisses one alert without changing the rest of Today", async () => {
    mockApi();
    render(<TodayPage />);
    await waitFor(() => expect(screen.getByText("Twin Falls County Fair")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      "/today/scout-alerts/50000000-0000-4000-8000-000000000001/dismiss",
      {},
    ));
    expect(screen.getAllByText("Another Fair").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText("Twin Falls County Fair")).not.toBeInTheDocument());
  });
});
