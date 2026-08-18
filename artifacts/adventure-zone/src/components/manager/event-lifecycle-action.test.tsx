// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lifecycle: null as any,
  api: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/lifecycle")) return { lifecycle: mocks.lifecycle };
    if (path.endsWith("/check-in") && init?.method === "POST") {
      mocks.lifecycle = { bookingId: "booking-1", checkedInAt: "2026-08-17T22:00:00.000Z", checkedOutAt: null, wrapUpStatus: "not_started" };
      return { lifecycle: mocks.lifecycle };
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
  it("checks in even when optional location is unavailable", async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "en-US", calendar: "gregory", numberingSystem: "latn", timeZone: "America/Denver", hourCycle: "h12", hour12: true,
    });
    const { hook } = memoryLocation({ path: "/manager", static: false });
    render(<Router hook={hook}><EventLifecycleAction bookingId="booking-1" /></Router>);
    fireEvent.click(await screen.findByRole("button", { name: "Check in" }));
    expect(await screen.findByRole("button", { name: "Check out" })).toBeInTheDocument();
    const call = mocks.api.mock.calls.find(([path]) => path === "/manager/events/booking-1/check-in");
    expect(call?.[1]).toEqual(expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ locationStatus: "denied", timeZone: "America/Denver" });
  });

  it("checks out and immediately opens the event wrap-up", async () => {
    mocks.lifecycle = { bookingId: "booking-1", checkedInAt: "2026-08-17T22:00:00.000Z", checkedOutAt: null, wrapUpStatus: "not_started" };
    const { hook, history } = memoryLocation({ path: "/manager/route", static: false });
    render(<Router hook={hook}><EventLifecycleAction bookingId="booking-1" /></Router>);
    fireEvent.click(await screen.findByRole("button", { name: "Check out" }));
    await waitFor(() => expect(history[history.length - 1]).toBe("/manager/events/booking-1/wrap-up"));
  });

  it("does not offer a new check in when the event is not eligible", async () => {
    const { hook } = memoryLocation({ path: "/manager/route", static: true });
    render(<Router hook={hook}><EventLifecycleAction bookingId="booking-1" allowCheckIn={false} /></Router>);
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Check in" })).not.toBeInTheDocument();
  });
});
