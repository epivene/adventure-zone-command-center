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

function summaryWithText(text: string) {
  return screen.getByText((_content, node) =>
    node?.tagName === "SUMMARY" && node.textContent?.replace(/\s+/g, " ").trim() === text,
  );
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPost.mockReset();
});

describe("TodayPage renewals", () => {
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
    expect(summaryWithText("Needs a decision (1)")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load next-season renewals.",
    );
  });

  it("explains post-event follow-up work while keeping normal lead status copy after opening decisions", async () => {
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

    const decisionsSummary = summaryWithText("Needs a decision (2)");
    const decisions = decisionsSummary.closest("details");
    expect(decisions).not.toHaveAttribute("open");
    fireEvent.click(decisionsSummary);

    expect(screen.getByText("Past event · Needs follow-up decision")).toBeInTheDocument();
    expect(screen.getByText("New Lead · Needs follow-up decision")).toBeInTheDocument();
  });

  it("starts the focused work disclosures closed even when contracts are the priority", async () => {
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

    const contracts = summaryWithText("Contracts (2)").closest("details");
    const later = screen.getByText("Later").closest("details");
    expect(contracts).not.toHaveAttribute("open");
    expect(later).not.toHaveAttribute("open");
  });
});
