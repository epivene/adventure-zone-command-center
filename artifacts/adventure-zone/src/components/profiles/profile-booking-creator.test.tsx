// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn().mockResolvedValue({ bookingId: "booking-1" }) }));
vi.mock("@/lib/auth-token", () => ({ apiPost }));

import { ProfileBookingCreator } from "./profile-booking-creator";
import { subscribeBookingOperationsChanges } from '@/features/bookings/booking-operations-changes';

it("creates a dated booking on the current profile", async () => {
  const onCreated = vi.fn();
  const changed = vi.fn();
  const dispose = subscribeBookingOperationsChanges(changed);
  render(<ProfileBookingCreator city="Holyoke" onCreated={onCreated} profileId="profile-1" region="CO" />);

  fireEvent.click(screen.getByText("Add booking"));
  fireEvent.change(screen.getByLabelText("Booking name"), { target: { value: "Phillips County Fair 2027 – Warrior's Playground" } });
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2027-07-29" } });
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2027-07-31" } });
  fireEvent.change(screen.getByLabelText("Next action due"), { target: { value: "2026-10-12" } });
  fireEvent.click(screen.getByRole("button", { name: "Create booking" }));

  await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/event-profiles/profile-1/bookings", expect.objectContaining({
    name: "Phillips County Fair 2027 – Warrior's Playground",
    startsAt: "2027-07-29",
    endsAt: "2027-07-31",
    city: "Holyoke",
    region: "CO",
    status: "pending_contract",
    nextActionDueAt: "2026-10-12",
  })));
  expect(onCreated).toHaveBeenCalled();
  expect(changed).toHaveBeenCalledWith('booking-1');
  dispose();
});
