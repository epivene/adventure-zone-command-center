// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { beforeEach, describe, expect, it, vi } from "vitest";

const baseLifecycle = {
  bookingId: "booking-1",
  checkedInAt: null,
  checkedOutAt: null,
  wrapUpStatus: "not_started",
  preEventChecklistState: "not_started",
  postEventChecklistState: "not_started",
  readyToOperate: false,
  hasSiteWideUnsafeIssue: false,
  hasChecklistFollowUpNeedsAttention: false,
};

const mocks = vi.hoisted(() => ({
  lifecycle: null as any,
  api: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/lifecycle")) return { lifecycle: mocks.lifecycle };
    if (path.endsWith("/check-in") && init?.method === "POST") {
      mocks.lifecycle = {
        ...baseLifecycle,
        checkedInAt: "2026-08-17T22:00:00.000Z",
        preEventChecklistState: "in_progress",
      };
      return { lifecycle: mocks.lifecycle, nextAction: "pre_event_checklist" };
    }
    if (path.endsWith("/checkout/start") && init?.method === "POST") {
      mocks.lifecycle = { ...mocks.lifecycle, postEventChecklistState: "in_progress" };
      return { lifecycle: mocks.lifecycle, nextAction: "post_event_checklist" };
    }
    if (path.endsWith("/check-out") && init?.method === "POST") {
      mocks.lifecycle = { ...mocks.lifecycle, checkedOutAt: "2026-08-17T23:00:00.000Z", wrapUpStatus: "incomplete" };
      return { lifecycle: mocks.lifecycle };
    }
    return {};
  }),
}));

vi.mock("@/lib/manager-auth-context", () => ({ useManagerAuth: () => ({ managerApi: mocks.api }) }));
vi.mock("@/features/manager/event-location", () => ({
  captureOptionalEventLocation: vi.fn(async () => ({ latitude: null, longitude: null, locationStatus: "denied" })),
}));

import { EventLifecycleAction } from "./event-lifecycle-action";

beforeEach(() => { mocks.lifecycle = null; mocks.api.mockClear(); });

describe("EventLifecycleAction", () => {
  it("saves check in and opens the pre-event checklist even without location", async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "en-US", calendar: "gregory", numberingSystem: "latn", timeZone: "America/Denver", hourCycle: "h12", hour12: true,
    });
    const { hook, history } = memoryLocation({ path: "/manager", static: false });
    render(<Router hook={hook}><EventLifecycleAction bookingId="booking-1" /></Router>);
    fireEvent.click(await screen.findByRole("button", { name: "Check in" }));
    await waitFor(() => expect(history[history.length - 1]).toBe("/manager/events/booking-1/checklist/pre-event"));
    const call = mocks.api.mock.calls.find(([path]) => path === "/manager/events/booking-1/check-in");
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ locationStatus: "denied", timeZone: "America/Denver" });
    expect(JSON.parse(String(call?.[1]?.body)).clientMutationId).toBeTruthy();
  });

  it("offers the unfinished pre-event checklist after arrival", async () => {
    mocks.lifecycle = { ...baseLifecycle, checkedInAt: "2026-08-17T22:00:00.000Z", preEventChecklistState: "in_progress" };
    const { hook } = memoryLocation({ path: "/manager", static: false });
    render(<Router hook={hook}><EventLifecycleAction bookingId="booking-1" /></Router>);
    expect(await screen.findByRole("link", { name: "Finish pre-event checklist" })).toHaveAttribute("href", "/manager/events/booking-1/checklist/pre-event");
  });

  it("starts checkout by opening the post-event checklist without recording departure", async () => {
    mocks.lifecycle = { ...baseLifecycle, checkedInAt: "2026-08-17T22:00:00.000Z", preEventChecklistState: "completed", readyToOperate: true };
    const { hook, history } = memoryLocation({ path: "/manager", static: false });
    render(<Router hook={hook}><EventLifecycleAction bookingId="booking-1" /></Router>);
    fireEvent.click(await screen.findByRole("button", { name: "Start checkout" }));
    await waitFor(() => expect(history[history.length - 1]).toBe("/manager/events/booking-1/checklist/post-event"));
    expect(mocks.api).toHaveBeenCalledWith("/manager/events/booking-1/checkout/start", expect.objectContaining({ method: "POST" }));
    expect(mocks.api).not.toHaveBeenCalledWith("/manager/events/booking-1/check-out", expect.anything());
  });

  it("offers the post-event checklist while it is in progress", async () => {
    mocks.lifecycle = { ...baseLifecycle, checkedInAt: "2026-08-17T22:00:00.000Z", preEventChecklistState: "completed", postEventChecklistState: "in_progress", readyToOperate: true };
    const { hook } = memoryLocation({ path: "/manager", static: false });
    render(<Router hook={hook}><EventLifecycleAction bookingId="booking-1" /></Router>);
    expect(await screen.findByRole("link", { name: "Finish post-event checklist" })).toHaveAttribute("href", "/manager/events/booking-1/checklist/post-event");
  });


  it("warns that checkout is late after the event buffer has ended", async () => {
    mocks.lifecycle = {
      ...baseLifecycle,
      checkedInAt: "2026-09-05T16:00:00.000Z",
      preEventChecklistState: "completed",
      readyToOperate: true,
    };
    const { hook } = memoryLocation({ path: "/manager", static: false });
    render(<Router hook={hook}><EventLifecycleAction {...({
      bookingId: "booking-1",
      checkoutDueAt: "2020-01-01T00:00:00.000Z",
    } as any)} /></Router>);
    expect(await screen.findByText("Event over — checkout late")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start checkout" })).toBeInTheDocument();
  });

  it("records final departure only after post-event checklist and opens wrap-up", async () => {
    mocks.lifecycle = { ...baseLifecycle, checkedInAt: "2026-08-17T22:00:00.000Z", preEventChecklistState: "completed", postEventChecklistState: "completed", readyToOperate: true };
    const { hook, history } = memoryLocation({ path: "/manager", static: false });
    render(<Router hook={hook}><EventLifecycleAction bookingId="booking-1" /></Router>);
    fireEvent.click(await screen.findByRole("button", { name: "Complete checkout" }));
    await waitFor(() => expect(history[history.length - 1]).toBe("/manager/events/booking-1/wrap-up"));
    expect(mocks.api).toHaveBeenCalledWith("/manager/events/booking-1/check-out", expect.objectContaining({ method: "POST" }));
  });

  it("does not offer a new check in when the event is not eligible", async () => {
    const { hook } = memoryLocation({ path: "/manager/route", static: true });
    render(<Router hook={hook}><EventLifecycleAction bookingId="booking-1" allowCheckIn={false} /></Router>);
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Check in" })).not.toBeInTheDocument();
  });
});
