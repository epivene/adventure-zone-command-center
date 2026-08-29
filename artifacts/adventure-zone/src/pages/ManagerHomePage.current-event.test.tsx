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
      if (path === "/manager/reviews/due") return Promise.resolve({ reviewsDue: [] });
      if (path === "/manager/events/lifecycle/current") return Promise.resolve({ lifecycle: { bookingId: "event-1", bookingName: "Eastern Montana Fair", city: "Miles City", region: "MT", checkedInAt: "2026-08-18T02:58:00.000Z" } });
      if (path === "/manager/map") return Promise.resolve({ events: [
        { bookingId: "event-1", bookingName: "Eastern Montana Fair", city: "Miles City", region: "MT", startsAt: "2026-08-18T17:00:00.000Z", status: "confirmed" },
        { bookingId: "event-2", bookingName: "Next County Fair", city: "Glendive", region: "MT", startsAt: "2026-08-22T17:00:00.000Z", status: "confirmed" },
      ] });
      if (path === "/manager/events/lifecycle/incomplete") return Promise.resolve({ lifecycles: [] });
      if (path === "/manager/money/summary") return Promise.resolve({});
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

  it("keeps Next Stop when there is no checked-in event", async () => {
    managerApi.mockImplementation((path: string) => {
      if (path === "/manager/reviews/due") return Promise.resolve({ reviewsDue: [] });
      if (path === "/manager/events/lifecycle/current") return Promise.resolve({ lifecycle: null });
      if (path === "/manager/map") return Promise.resolve({ events: [{ bookingId: "event-2", bookingName: "Next County Fair", city: "Glendive", region: "MT", startsAt: "2026-08-22T17:00:00.000Z", status: "confirmed" }] });
      if (path === "/manager/events/lifecycle/incomplete") return Promise.resolve({ lifecycles: [] });
      if (path === "/manager/money/summary") return Promise.resolve({});
      return Promise.reject(new Error(`Unexpected ${path}`));
    });

    render(<ManagerHomePage />);
    await waitFor(() => expect(screen.getByText("Next Stop")).toBeInTheDocument());
    expect(screen.queryByText("Current Event")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Event notes / site check" })).not.toBeInTheDocument();
  });

  it("shows a definite assigned event as the next stop before its workflow status is confirmed", async () => {
    managerApi.mockImplementation((path: string) => {
      if (path === "/manager/reviews/due") return Promise.resolve({ reviewsDue: [] });
      if (path === "/manager/events/lifecycle/current") return Promise.resolve({ lifecycle: null });
      if (path === "/manager/map") return Promise.resolve({ events: [{
        bookingId: "event-definite",
        bookingName: "Definite County Fair",
        city: "Glendive",
        region: "MT",
        startsAt: "2026-09-12T17:00:00.000Z",
        status: "pending_contract",
        probability: "definite",
      }] });
      if (path === "/manager/events/lifecycle/incomplete") return Promise.resolve({ lifecycles: [] });
      if (path === "/manager/money/summary") return Promise.resolve({});
      return Promise.reject(new Error(`Unexpected ${path}`));
    });

    render(<ManagerHomePage />);

    expect(await screen.findByText("Definite County Fair")).toBeInTheDocument();
    expect(screen.getByText("Next Stop")).toBeInTheDocument();
  });
});