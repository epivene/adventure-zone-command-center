// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const managerApi = vi.hoisted(() => vi.fn());

vi.mock("@/lib/manager-auth-context", () => ({
  useManagerAuth: () => ({ manager: { legName: "Kristy" }, managerApi }),
}));
vi.mock("@/features/manager-assistant/manager-assistant-context", () => ({
  useManagerAssistant: () => ({ setActiveContext: vi.fn(), openAssistant: vi.fn() }),
}));
vi.mock("@/components/manager/event-lifecycle-action", () => ({
  EventLifecycleAction: ({ bookingId }: { bookingId: string }) => <div>Checked in Aug 17, 8:58 PM · Lifecycle {bookingId}</div>,
}));
vi.mock("wouter", () => ({ Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));

import ManagerHomePage from "./ManagerHomePage";

afterEach(() => { cleanup(); managerApi.mockReset(); });

describe("ManagerHomePage current event state", () => {
  it("shows a checked-in event as Current Event and the following confirmed event as Up Next", async () => {
    managerApi.mockImplementation((path: string) => {
      if (path === "/manager/dashboard") return Promise.resolve({
        events: [
          { bookingId: "event-1", bookingName: "Eastern Montana Fair", city: "Miles City", region: "MT", startsAt: "2026-08-18T17:00:00.000Z", status: "confirmed", scheduleState: "booked" },
          { bookingId: "event-2", bookingName: "Next County Fair", city: "Glendive", region: "MT", startsAt: "2026-08-22T17:00:00.000Z", status: "confirmed", scheduleState: "booked" },
        ],
        currentLifecycle: { bookingId: "event-1", bookingName: "Eastern Montana Fair", city: "Miles City", region: "MT", checkedInAt: "2026-08-18T02:58:00.000Z" },
        incompleteWrapUps: [],
        reviewsDue: [],
        money: {},
        summary: { reviewsDueCount: 0 },
      });
      return Promise.reject(new Error(`Unexpected ${path}`));
    });

    render(<ManagerHomePage />);

    await waitFor(() => expect(screen.getByText("Current Event")).toBeInTheDocument());
    expect(screen.getByText("Eastern Montana Fair")).toBeInTheDocument();
    expect(screen.getByText("Up Next")).toBeInTheDocument();
    expect(screen.getByText("Next County Fair")).toBeInTheDocument();
    expect(screen.queryByText("Next Stop")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Checked in Aug 17, 8:58 PM/)).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Event notes / site check" })).toHaveAttribute("href", "/manager/events/event-1/wrap-up#site-check");
  });

  it("keeps primary dashboard data visible when a secondary section is partial", async () => {
    managerApi.mockResolvedValue({
      events: [{ bookingId: "event-3", bookingName: "Partial County Fair", city: "Helena", region: "MT", startsAt: "2026-08-22T17:00:00.000Z", status: "confirmed", scheduleState: "booked" }],
      currentLifecycle: null,
      incompleteWrapUps: [],
      reviewsDue: [],
      money: {},
      summary: { reviewsDueCount: 0 },
      partialErrors: [{ section: "money", message: "Finance unavailable" }],
    });

    render(<ManagerHomePage />);

    expect(await screen.findByText("Partial County Fair")).toBeInTheDocument();
    expect(screen.getByText("Some dashboard details are unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Finance unavailable")).toBeInTheDocument();
  });

  it("keeps Next Stop when there is no checked-in event", async () => {
    managerApi.mockImplementation((path: string) => {
      if (path === "/manager/dashboard") return Promise.resolve({
        events: [{ bookingId: "event-2", bookingName: "Next County Fair", city: "Glendive", region: "MT", startsAt: "2026-08-22T17:00:00.000Z", status: "confirmed", scheduleState: "booked" }],
        currentLifecycle: null,
        incompleteWrapUps: [],
        reviewsDue: [],
        money: {},
        summary: { reviewsDueCount: 0 },
      });
      return Promise.reject(new Error(`Unexpected ${path}`));
    });

    render(<ManagerHomePage />);
    await waitFor(() => expect(screen.getByText("Next Stop")).toBeInTheDocument());
    expect(screen.queryByText("Current Event")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Event notes / site check" })).not.toBeInTheDocument();
  });

  it("shows a definite assigned event as the next stop before its workflow status is confirmed", async () => {
    managerApi.mockImplementation((path: string) => {
      if (path === "/manager/dashboard") return Promise.resolve({
        events: [{
        bookingId: "event-definite",
        bookingName: "Definite County Fair",
        city: "Glendive",
        region: "MT",
        startsAt: "2026-09-12T17:00:00.000Z",
        status: "pending_contract",
        probability: "definite",
        scheduleState: "booked",
      }],
      currentLifecycle: null,
      incompleteWrapUps: [],
      reviewsDue: [],
      money: {},
      summary: { reviewsDueCount: 0 },
      });
      return Promise.reject(new Error(`Unexpected ${path}`));
    });

    render(<ManagerHomePage />);

    expect(await screen.findByText("Definite County Fair")).toBeInTheDocument();
    expect(screen.getByText("Next Stop")).toBeInTheDocument();
  });
});