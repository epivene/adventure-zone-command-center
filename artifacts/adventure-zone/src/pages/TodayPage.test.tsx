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
    if (path === "/outreach-planner/") return Promise.resolve({ enabled: false, candidates: [], openings: [], legs: [], packages: [], researchTasks: [] });
    if (path === "/today") return Promise.resolve(value);
    if (path === "/calls/config") {
      return Promise.resolve({
        assistedCallingEnabled: false,
        voicemailLauncherUrl: null,
      });
    }
    if (path === "/business-documents/review-count") return Promise.resolve({ count: 0 });
    return Promise.reject(new Error(`Unexpected API path: ${path}`));
  });
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPost.mockReset();
  window.history.replaceState(null, "", "/");
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

describe("TodayPage renewals", () => {
  it("opens the outreach planner for links from email send review", async () => {
    mockDashboard(dashboard());
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    window.history.replaceState(null, "", "/today?section=outreach-planner");

    render(<TodayPage />);
    await waitFor(() => {
      expect(document.getElementById("route-outreach-planner")).toHaveAttribute("open");
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("shows document attention separately from calls and follow-ups", async () => {
    mockDashboard(dashboard());
    apiGet.mockImplementation((path: string) => {
      if (path === "/outreach-planner/") return Promise.resolve({ enabled: false, candidates: [], openings: [], legs: [], packages: [], researchTasks: [] });
    if (path === "/today") return Promise.resolve(dashboard());
      if (path === "/calls/config") return Promise.resolve({ assistedCallingEnabled: false, voicemailLauncherUrl: null });
      if (path === "/business-documents/review-count") return Promise.resolve({ count: 3 });
      return Promise.reject(new Error(`Unexpected API path: ${path}`));
    });
    render(<TodayPage />);
    expect(await screen.findByText("3 documents need review")).toBeVisible();
    expect(screen.getByRole("link", { name: "Review documents" })).toHaveAttribute("href", "/business-documents?view=review");
  });

  it("keeps later renewals collapsed and separate from current-season work", async () => {
    mockDashboard(dashboard());
    render(<TodayPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Current Fair Lead").length).toBeGreaterThan(0);
    });

    const toggle = screen.getByRole("button", { name: /Next Season \/ Renewals \(1\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("County Fair Renewal")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText("County Fair Renewal")).toBeInTheDocument();
    expect(screen.getAllByText("Current Fair Lead").length).toBeGreaterThan(0);
  });

  it("keeps an urgent renewal collapsed until the user opens it", async () => {
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
      expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    });
    const toggle = screen.getByRole("button", { name: /Next Season \/ Renewals \(1\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("County Fair Renewal")).not.toBeInTheDocument();
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
    expect(screen.getByRole("region", { name: "Daily work queue" })).toBeVisible();
    expect(screen.getAllByText("Current Fair Lead").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load next-season renewals.",
    );
  });

  it("explains post-event follow-up work and lead work directly in the queue", async () => {
    mockDashboard(
      dashboard({
        needsFollowUpPlan: [currentBooking, postEventBooking],
        needsFollowUpPlanTotal: 2,
      }),
    );
    render(<TodayPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    });

    expect(screen.getByRole("radio", { name: /Eastern Montana Fair/ })).toBeVisible();
    expect(screen.getByText(/Past event needs a follow-up decision/)).toBeVisible();
    expect(screen.getByRole("radio", { name: /Current Fair Lead/ })).toBeVisible();
    expect(screen.getAllByText(/No future reminder scheduled/).length).toBeGreaterThan(0);
  });

  it("keeps later work collapsed alongside the invoice and contract workspace", async () => {
    mockDashboard(
      dashboard({
        contractCount: 2,
        needsFollowUpPlan: [],
        needsFollowUpPlanTotal: 0,
      }),
    );
    render(<TodayPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    });

    const tools = screen.getByText("Booking tools").closest("details");
    expect(tools).not.toHaveAttribute("open");
    expect(screen.getByRole("link", { name: "Open workspace", hidden: true })).toHaveAttribute("href", "/invoices-contracts");
    const later = screen.getByText("Schedule & renewals").closest("details");
    expect(later).not.toHaveAttribute("open");
  });
});

    const scrollIntoView = vi.fn();
