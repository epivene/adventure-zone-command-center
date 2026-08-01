// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { BookingForm } from "@/components/bookings/booking-form";
import { bookingEditInputSchema } from "@/features/bookings/booking-input";

const legId = "11111111-1111-4111-8111-111111111111";

afterEach(cleanup);

describe("booking event edit input", () => {
  it("normalizes all Stage 1 calendar and map fields", () => {
    const result = bookingEditInputSchema.safeParse({
      name: "  Updated Fair  ",
      venueName: "  River Grounds  ",
      address1: "  10 Main St  ",
      city: "  Fargo  ",
      region: "nd",
      postalCode: " 58102 ",
      latitude: "46.8772",
      longitude: "-96.7898",
      startsAt: "2026-11-01",
      endsAt: "2026-11-03",
      status: "confirmed",
      probability: "likely",
      travelLegId: legId,
      notes: "  Bring the blue trailer.  ",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      name: "Updated Fair",
      venueName: "River Grounds",
      address1: "10 Main St",
      city: "Fargo",
      region: "ND",
      postalCode: "58102",
      latitude: 46.8772,
      longitude: -96.7898,
      startsAt: new Date("2026-11-01T18:00:00.000Z"),
      endsAt: new Date("2026-11-03T18:00:00.000Z"),
      status: "confirmed",
      probability: "likely",
      travelLegId: legId,
      notes: "Bring the blue trailer.",
    });
  });

  it("supports explicitly clearing both coordinates and the travel leg", () => {
    const result = bookingEditInputSchema.safeParse({
      name: "Unmapped Fair",
      venueName: "",
      address1: "",
      city: "Fargo",
      region: "ND",
      postalCode: "",
      latitude: "  ",
      longitude: "\t",
      startsAt: "",
      endsAt: "",
      status: "possible",
      probability: "possible",
      travelLegId: "",
      notes: "",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      latitude: null,
      longitude: null,
      startsAt: null,
      endsAt: null,
      travelLegId: null,
      notes: null,
    });
  });

  it("rejects one-sided coordinates and an end date before the start date", () => {
    const oneCoordinate = bookingEditInputSchema.safeParse({
      name: "Broken Map",
      venueName: "",
      address1: "",
      city: "Fargo",
      region: "ND",
      postalCode: "",
      latitude: "46.8",
      longitude: "",
      startsAt: "",
      endsAt: "",
      status: "possible",
      probability: "possible",
      travelLegId: "",
      notes: "",
    });
    const reversedDates = bookingEditInputSchema.safeParse({
      name: "Broken Dates",
      venueName: "",
      address1: "",
      city: "Fargo",
      region: "ND",
      postalCode: "",
      latitude: "",
      longitude: "",
      startsAt: "2026-08-10",
      endsAt: "2026-08-09",
      status: "possible",
      probability: "possible",
      travelLegId: "",
      notes: "",
    });

    expect(oneCoordinate.success).toBe(false);
    expect(reversedDates.success).toBe(false);
  });

  it("submits editable dates, location, coordinates, leg, status, and notes", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <BookingForm
        initialValues={{
          name: "Original Fair",
          venueName: "",
          address1: "",
          city: "Fargo",
          region: "ND",
          postalCode: "",
          latitude: "",
          longitude: "",
          startsAt: "",
          endsAt: "",
          status: "possible",
          probability: "possible",
          travelLegId: "",
          notes: "",
        }}
        onSubmit={onSubmit}
        travelLegs={[
          { id: legId, name: "North crew", color: "#123456", sortOrder: 1 },
        ]}
        variant="edit"
      />,
    );

    await user.type(screen.getByLabelText("Venue"), "River Grounds");
    await user.type(screen.getByLabelText("Street address"), "10 Main St");
    await user.type(screen.getByLabelText("Start date"), "2026-08-10");
    await user.type(screen.getByLabelText("End date"), "2026-08-12");
    await user.type(screen.getByLabelText("Latitude"), "46.8772");
    await user.type(screen.getByLabelText("Longitude"), "-96.7898");
    await user.selectOptions(screen.getByLabelText("Travel leg"), legId);
    await user.selectOptions(screen.getByLabelText("Status"), "confirmed");
    await user.type(screen.getByLabelText("Notes"), "Map-ready booking");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        venueName: "River Grounds",
        startsAt: new Date("2026-08-10T17:00:00.000Z"),
        endsAt: new Date("2026-08-12T17:00:00.000Z"),
        latitude: 46.8772,
        longitude: -96.7898,
        travelLegId: legId,
        status: "confirmed",
        notes: "Map-ready booking",
      }),
    );
  });
});
