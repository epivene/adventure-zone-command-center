// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { BookingForm } from "@/components/bookings/booking-form";
import {
  BookingList,
  type BookingListItem,
} from "@/components/bookings/booking-list";
import { FollowUpCompletionDialog } from "@/components/bookings/follow-up-completion-dialog";
import { followUpCompletionInputSchema } from "@/features/bookings/follow-up-completion-input";

afterEach(() => {
  cleanup();
  localStorage.clear();
  routerPush.mockReset();
  vi.restoreAllMocks();
});

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

  it("restores a local draft only after the user explicitly chooses it", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "azcc:draft:booking:new",
      JSON.stringify({
        version: 1,
        savedAt: "2026-07-25T15:30:00.000Z",
        data: {
          name: "Draft Fair",
          city: "Fargo",
          region: "ND",
          status: "new_lead",
          probability: "possible",
          nextActionKind: "call",
          nextActionDueAt: "2026-08-01",
        },
      }),
    );

    render(<BookingForm draftKey="booking:new" onSubmit={vi.fn()} />);

    expect(screen.getByLabelText("Event name")).toHaveValue("");
    await user.click(await screen.findByRole("button", { name: "Restore draft" }));
    expect(screen.getByLabelText("Event name")).toHaveValue("Draft Fair");
    expect(screen.getByText("Local draft — not saved")).toBeVisible();
  });

  it("saves offline edits as a clearly labeled local draft", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const user = userEvent.setup();
    render(<BookingForm draftKey="booking:new" onSubmit={vi.fn()} />);

    await user.type(screen.getByLabelText("Event name"), "Offline Fair");

    expect(screen.getByText("Local draft — not saved")).toBeVisible();
    expect(
      JSON.parse(localStorage.getItem("azcc:draft:booking:new") ?? "{}").data,
    ).toMatchObject({ name: "Offline Fair" });
  });

  it("explains when an offline draft cannot be saved on the device", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    const user = userEvent.setup();
    render(<BookingForm draftKey="booking:new" onSubmit={vi.fn()} />);

    await user.type(screen.getByLabelText("Event name"), "Offline Fair");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Draft could not be saved on this device",
    );
  });

  it("deletes a local draft and navigates only after explicit server success", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    localStorage.setItem(
      "azcc:draft:booking:edit:123",
      JSON.stringify({
        version: 1,
        savedAt: "2026-07-25T15:30:00.000Z",
        data: { name: "Old draft" },
      }),
    );
    render(
      <BookingForm
        draftKey="booking:edit:123"
        initialValues={{
          name: "Saved Fair",
          city: "Fargo",
          region: "ND",
          probability: "possible",
        }}
        onSubmit={onSubmit}
        successPath="/bookings/123"
        variant="edit"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(localStorage.getItem("azcc:draft:booking:edit:123")).toBeNull();
    expect(routerPush).toHaveBeenCalledWith("/bookings/123");
  });

  it("retains and labels the draft when submission returns undefined", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <BookingForm
        draftKey="booking:edit:123"
        initialValues={{
          name: "Unconfirmed Fair",
          city: "Fargo",
          region: "ND",
          probability: "possible",
        }}
        onSubmit={onSubmit}
        successPath="/bookings/123"
        variant="edit"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByText("Local draft — not saved")).toBeVisible();
    expect(
      JSON.parse(
        localStorage.getItem("azcc:draft:booking:edit:123") ?? "{}",
      ).data,
    ).toMatchObject({ name: "Unconfirmed Fair" });
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("retains and labels the draft when submission rejects", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error("Connection lost"));
    render(
      <BookingForm
        draftKey="booking:edit:123"
        initialValues={{
          name: "Rejected Fair",
          city: "Fargo",
          region: "ND",
          probability: "possible",
        }}
        onSubmit={onSubmit}
        successPath="/bookings/123"
        variant="edit"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByText("Local draft — not saved")).toBeVisible();
    expect(
      JSON.parse(
        localStorage.getItem("azcc:draft:booking:edit:123") ?? "{}",
      ).data,
    ).toMatchObject({ name: "Rejected Fair" });
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("keeps a local draft when the server rejects the save", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, error: "Try again." });
    localStorage.setItem(
      "azcc:draft:booking:edit:123",
      JSON.stringify({
        version: 1,
        savedAt: "2026-07-25T15:30:00.000Z",
        data: { name: "Keep me" },
      }),
    );
    render(
      <BookingForm
        draftKey="booking:edit:123"
        initialValues={{
          name: "Saved Fair",
          city: "Fargo",
          region: "ND",
          probability: "possible",
        }}
        onSubmit={onSubmit}
        variant="edit"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Try again.");
    expect(screen.getByText("Local draft — not saved")).toBeVisible();
    expect(
      JSON.parse(
        localStorage.getItem("azcc:draft:booking:edit:123") ?? "{}",
      ).data,
    ).toMatchObject({ name: "Saved Fair" });
  });

  it("does not claim a draft was removed when device storage rejects deletion", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    render(
      <BookingForm
        draftKey="booking:edit:123"
        initialValues={{
          name: "Saved Fair",
          city: "Fargo",
          region: "ND",
          probability: "possible",
        }}
        onSubmit={onSubmit}
        variant="edit"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByText("Local draft — not saved")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Draft could not be removed from this device",
    );
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
