// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BookingForm } from "@/components/bookings/booking-form";
import {
  BookingList,
  type BookingListItem,
} from "@/components/bookings/booking-list";
import { FollowUpCompletionDialog } from "@/components/bookings/follow-up-completion-dialog";
import { followUpCompletionInputSchema } from "@/features/bookings/follow-up-completion-input";

afterEach(cleanup);

describe("BookingForm", () => {
  it("requires event name, city, state, status, and next action for an active lead", async () => {
    const user = userEvent.setup();
    render(<BookingForm onSubmit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Save lead" }));

    expect(await screen.findByText("Event name is required")).toBeVisible();
    expect(screen.getByText("City is required")).toBeVisible();
    expect(screen.getByText("State is required")).toBeVisible();
    expect(screen.getByText("Choose the next action")).toBeVisible();
    expect(screen.getByText("Choose the next follow-up date")).toBeVisible();
  });

  it("edits core booking details without requiring a new follow-up", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <BookingForm
        initialValues={{
          name: "Original Fair",
          city: "Fargo",
          region: "ND",
          probability: "possible",
        }}
        onSubmit={onSubmit}
        variant="edit"
      />,
    );

    await user.clear(screen.getByLabelText("Event name"));
    await user.type(screen.getByLabelText("Event name"), "Updated Fair");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Updated Fair",
      city: "Fargo",
      region: "ND",
      probability: "possible",
    });
  });
});

const bookings: BookingListItem[] = [
  {
    id: "booking-1",
    name: "Overdue County Fair",
    city: "Fargo",
    region: "ND",
    startsAt: new Date("2026-08-10T12:00:00Z"),
    endsAt: new Date("2026-08-12T12:00:00Z"),
    status: "contact_due",
    probability: "likely",
    travelLeg: { id: "leg-1", name: "Northern leg", color: "#2563eb" },
    nextAction: {
      id: "follow-up-1",
      kind: "call",
      dueAt: new Date("2026-07-24T12:00:00Z"),
    },
  },
  {
    id: "booking-2",
    name: "Interested Festival",
    city: "Austin",
    region: "TX",
    startsAt: null,
    endsAt: null,
    status: "interested",
    probability: "possible",
    travelLeg: null,
    nextAction: null,
  },
];

describe("BookingList", () => {
  it("shows booking context and calls attention to an overdue next action", () => {
    render(<BookingList bookings={bookings} now={new Date("2026-07-25T12:00:00Z")} />);

    expect(screen.getByRole("link", { name: "Overdue County Fair" })).toBeVisible();
    expect(screen.getByText("Fargo, ND")).toBeVisible();
    expect(screen.getByText("Northern leg")).toBeVisible();
    expect(screen.getByText("Overdue")).toBeVisible();
  });

  it("filters bookings by status without deleting unrelated records", async () => {
    const user = userEvent.setup();
    render(<BookingList bookings={bookings} now={new Date("2026-07-25T12:00:00Z")} />);

    await user.selectOptions(screen.getByLabelText("Booking status"), "interested");

    expect(screen.getByRole("link", { name: "Interested Festival" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Overdue County Fair" })).not.toBeInTheDocument();
  });
});

describe("FollowUpCompletionDialog", () => {
  it("rejects an empty outcome at the server-action validation boundary", () => {
    const result = followUpCompletionInputSchema.safeParse({
      followUpId: "follow-up-1",
      outcome: "",
      status: "declined",
      nextAction: null,
    });

    expect(result.success).toBe(false);
  });

  it("keeps the dialog open and explains when the service requires a next action", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "NEXT_ACTION_REQUIRED" as const },
    });
    render(
      <FollowUpCompletionDialog
        bookingStatus="interested"
        followUpId="follow-up-1"
        onComplete={onComplete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Complete call" }));
    await user.selectOptions(screen.getByLabelText("Call outcome"), "call_again");
    await user.selectOptions(screen.getByLabelText("Next action type"), "call");
    await user.type(screen.getByLabelText("Next action date"), "2026-08-03");
    await user.click(screen.getByRole("button", { name: "Save call outcome" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a next action and date before completing this call.",
    );
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("moves focus into the dialog and restores it when Escape closes", async () => {
    const user = userEvent.setup();
    render(
      <FollowUpCompletionDialog
        bookingStatus="interested"
        followUpId="follow-up-1"
        onComplete={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Complete call" });
    await user.click(trigger);

    expect(screen.getByLabelText("Call outcome")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
