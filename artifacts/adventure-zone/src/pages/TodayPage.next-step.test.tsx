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

const booking = {
  id: "30000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  primaryContactId: "20000000-0000-4000-8000-000000000001",
  name: "Utah Juneteenth Festival",
  status: "possible",
  probability: "possible",
  planReason: "needs_action",
  operations: {
    packageNames: [],
    sharedAttractionTotal: null,
    pendingRequestCount: 0,
    leg: null,
    warnings: [],
  },
};

function dashboard(items = [booking]) {
  return {
    followUpCount: 0,
    newLeadCount: 0,
    contractCount: 0,
    visibleRouteWarningCount: 0,
    nextCall: null,
    followUps: [],
    followUpTotal: 0,
    followUpPage: 1,
    followUpPageCount: 1,
    needsFollowUpPlan: items,
    needsFollowUpPlanTotal: items.length,
    needsFollowUpPlanPage: 1,
    needsFollowUpPlanPageCount: 1,
    upcomingEvents: [],
    todayTrips: [],
    renewals: [],
    renewalTotal: 0,
    renewalProminentCount: 0,
    renewalError: null,
  };
}

function mockDashboard() {
  apiGet.mockImplementation((path: string) => {
    if (path === "/today") return Promise.resolve(dashboard());
    if (path === "/calls/config") return Promise.resolve({ assistedCallingEnabled: false, voicemailLauncherUrl: null });
    return Promise.reject(new Error(`Unexpected API path: ${path}`));
  });
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPost.mockReset();
});

describe("Today needs-a-next-step controls", () => {
  it("hides empty package/attraction noise and exposes manage controls", async () => {
    mockDashboard();
    render(<TodayPage />);

    await waitFor(() => expect(screen.getAllByText("Utah Juneteenth Festival").length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "Manage next steps" })).toBeInTheDocument();
    expect(screen.queryByText(/0 packages/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No attractions/i)).not.toBeInTheDocument();
  });

  it("clears an item with one action and offers undo", async () => {
    mockDashboard();
    apiPost.mockResolvedValue({ ok: true });
    render(<TodayPage />);

    await waitFor(() => expect(screen.getAllByText("Utah Juneteenth Festival").length).toBeGreaterThan(0));
    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Utah Juneteenth Festival" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "No follow-up needed" }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/today/next-step/clear", {
        bookingIds: [booking.id],
        reason: "no_follow_up_needed",
      });
    });
    expect(screen.queryByText("Utah Juneteenth Festival")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("supports bulk selection from Manage mode", async () => {
    mockDashboard();
    apiPost.mockResolvedValue({ ok: true });
    render(<TodayPage />);

    await waitFor(() => expect(screen.getAllByText("Utah Juneteenth Festival").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Manage next steps" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Utah Juneteenth Festival" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selected" }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/today/next-step/clear", {
        bookingIds: [booking.id],
        reason: "no_follow_up_needed",
      });
    });
  });
});
