// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-token", () => ({ apiGet, apiPost }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import TodayPage from "./TodayPage";

const currentBooking = {
  id: "30000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  primaryContactId: "20000000-0000-4000-8000-000000000001",
  name: "Current Fair Lead",
  status: "new_lead",
  probability: "possible",
  planReason: "needs_action",
  operations: null,
};

const postEventBooking = {
  ...currentBooking,
  id: "30000000-0000-4000-8000-000000000004",
  organizationId: "10000000-0000-4000-8000-000000000004",
  primaryContactId: "20000000-0000-4000-8000-000000000004",
  name: "Eastern Montana Fair",
  status: "confirmed",
  planReason: "post_event",
};

const laterRenewal = {
  id: "30000000-0000-4000-8000-000000000002",
  organizationId: "10000000-0000-4000-8000-000000000002",
  primaryContactId: "20000000-0000-4000-8000-000000000002",
  name: "County Fair Renewal",
  status: "renewal_due",
  probability: "possible",
  followUpId: "40000000-0000-4000-8000-000000000002",
  dueAt: "2026-11-01T18:00:00.000Z",
  attention: "later",
  operations: null,
};

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    followUpCount: 0,
    newLeadCount: 1,
    contractCount: 0,
    visibleRouteWarningCount: 0,
    nextCall: null,
    followUps: [],
    followUpTotal: 0,
    followUpPage: 1,
    followUpPageCount: 1,
    needsFollowUpPlan: [currentBooking],
    needsFollowUpPlanTotal: 1,
    needsFollowUpPlanPage: 1,
    needsFollowUpPlanPageCount: 1,
    upcomingEvents: [],
    todayTrips: [],
    renewals: [laterRenewal],
    renewalTotal: 1,
    renewalProminentCount: 0,
    renewalError: null,
    ...overrides,
  };
}

function mockDashboard(value: ReturnType<typeof dashboard>) {
  apiGet.mockImplementation((path: string) => {
    if (path === "/today") return Promise.resolve(value);
    if (path === "/calls/config") {
      return Promise.resolve({
        assistedCallingEnabled: false,
        voicemailLauncherUrl: null,
      });
    }
    return Promise.reject(new Error(`Unexpected API path: ${path}`));
  });
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPost.mockReset();
});

describe("TodayPage renewals", () => {
  it("keeps later renewals collapsed and separate from current-season work", async () => {
    mockDashboard(dashboard());
    render(<TodayPage />);

    await waitFor(() => {
      expect(screen.getByText("Current Fair Lead")).toBeInTheDocument();
    });

    const toggle = screen.getByRole("button", {
      name: /Next Season \/ Renewals \(1\)/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("County Fair Renewal")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText("County Fair Renewal")).toBeInTheDocument();
    expect(screen.getByText("Current Fair Lead")).toBeInTheDocument();
  });

  it("shows a renewal immediately when it is within 30 days", async () => {
    mockDashboard(
      dashboard({
        renewals: [
          {
            ...laterRenewal,
            dueAt: "2026-08-30T18:00:00.000Z",
            attention: "soon",
          },
        ],
        renewalProminentCount: 1,
      }),
    );
    render(<TodayPage />);

    await waitFor(() => {
      expect(screen.getByText("County Fair Renewal")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /Next Season \/ Renewals \(1\)/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps Today usable when only renewal loading fails", async () => {
    mockDashboard(
      dashboard({
        renewals: [],
        renewalTotal: 0,
        renewalProminentCount: 0,
        renewalError: "Could not load next-season renewals.",
      }),
    );
    render(<TodayPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    });
    expect(screen.getByText("Needs a decision (1)")).toBeInTheDocument();
    expect(screen.getByText("Current Fair Lead")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load next-season renewals.",
    );
  });

  it("explains post-event follow-up work while keeping normal lead status copy", async () => {
    mockDashboard(
      dashboard({
        needsFollowUpPlan: [currentBooking, postEventBooking],
        needsFollowUpPlanTotal: 2,
      }),
    );
    render(<TodayPage />);

    await waitFor(() => {
      expect(screen.getByText("Eastern Montana Fair")).toBeInTheDocument();
    });

    expect(screen.getByText("Past event · Needs follow-up decision")).toBeInTheDocument();
    expect(screen.getByText("New Lead · Needs follow-up decision")).toBeInTheDocument();
  });
});
