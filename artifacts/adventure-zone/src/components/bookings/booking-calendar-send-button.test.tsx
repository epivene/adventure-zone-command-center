// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { BookingCalendarSendButton } from "./booking-calendar-send-button";

describe("BookingCalendarSendButton", () => {
  it("sends the booking and confirms it was sent to Dave's calendar", async () => {
    const syncBooking = vi.fn().mockResolvedValue({ state: "synced", created: 1, updated: 0 });

    render(<BookingCalendarSendButton bookingId="11111111-1111-4111-8111-111111111111" syncBooking={syncBooking} />);
    fireEvent.click(screen.getByRole("button", { name: "Send to Dave's Calendar" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Sent to Dave's Calendar" })).toBeTruthy());
    expect(screen.getByRole("status").textContent).toContain("Sent to Dave's Calendar");
    expect(syncBooking).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("explains what must be completed when the booking cannot be sent", async () => {
    const syncBooking = vi.fn().mockResolvedValue({ state: "not_confirmed_or_incomplete" });

    render(<BookingCalendarSendButton bookingId="22222222-2222-4222-8222-222222222222" syncBooking={syncBooking} />);
    fireEvent.click(screen.getByRole("button", { name: "Send to Dave's Calendar" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("confirmed status, dates, a leg, and a package"));
  });
});
