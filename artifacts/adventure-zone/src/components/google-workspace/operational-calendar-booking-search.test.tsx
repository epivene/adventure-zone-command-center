// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OperationalCalendarBookingSearch } from "./operational-calendar-booking-search";
const search = vi.hoisted(() => vi.fn());
vi.mock("@/features/google-workspace/operational-calendar-client", () => ({ searchOperationalCalendarBookings: search }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const candidate = { bookingId: "booking-2026", profileName: "Blanding", bookingName: "Fall Festival 2026", city: "Blanding", region: "UT", startsAt: "2026-09-11", endsAt: "2026-09-12" };
it("finds and explicitly selects an existing booking without automatic candidates", async () => {
  search.mockResolvedValue({ candidates: [candidate] });
  const onSelect = vi.fn();
  render(<OperationalCalendarBookingSearch disabled={false} selectedBookingId="" onSelect={onSelect} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Blanding" } });
  fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));
  await screen.findByText("Blanding");
  expect(onSelect).not.toHaveBeenCalledWith(candidate.bookingId);
  fireEvent.click(screen.getByRole("radio"));
  expect(onSelect).toHaveBeenLastCalledWith(candidate.bookingId);
  expect(screen.getByText(/2026-09-11/)).toBeTruthy();
});
it("ignores old results and clears selection when the query changes", async () => {
  let resolve!: (value: unknown) => void;
  search.mockReturnValue(new Promise(r => { resolve = r; }));
  const onSelect = vi.fn();
  render(<OperationalCalendarBookingSearch disabled={false} selectedBookingId="old" onSelect={onSelect} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Blanding" } });
  fireEvent.click(screen.getByRole("button"));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "White Pine" } });
  await act(async () => resolve({ candidates: [candidate] }));
  expect(screen.queryByRole("radio")).toBeNull();
  expect(onSelect).toHaveBeenLastCalledWith("");
});
it("shows errors and supports retry and empty results", async () => {
  search.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ candidates: [] });
  render(<OperationalCalendarBookingSearch disabled={false} selectedBookingId="" onSelect={() => {}} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "White Pine" } });
  fireEvent.click(screen.getByRole("button"));
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("No bookings found"));
});
