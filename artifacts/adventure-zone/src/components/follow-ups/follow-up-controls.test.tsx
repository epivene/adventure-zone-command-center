import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const deleteFollowUpAction = vi.hoisted(() => vi.fn());
const editFollowUpAction = vi.hoisted(() => vi.fn());

vi.mock("@/actions/follow-ups", () => ({
  deleteFollowUpAction,
  editFollowUpAction,
}));

import { FollowUpControls } from "./follow-up-controls";
import type { FollowUpRecord } from "@/features/follow-ups/follow-up-types";

const followUp: FollowUpRecord = {
  id: "60000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  contactId: "20000000-0000-4000-8000-000000000001",
  bookingId: "30000000-0000-4000-8000-000000000001",
  kind: "call",
  dueAt: new Date("2026-08-20T17:00:00.000Z"),
  completedAt: null,
  outcome: null,
};

afterEach(() => {
  cleanup();
  deleteFollowUpAction.mockReset();
  editFollowUpAction.mockReset();
  vi.restoreAllMocks();
});

describe("FollowUpControls", () => {
  it("opens a collapsed form with editable date, type, completion, and conditional outcome fields", () => {
    render(<FollowUpControls followUp={followUp} onChanged={vi.fn()} onDeleted={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Edit follow-up" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete follow-up" })).toBeVisible();
    expect(screen.queryByLabelText("Due date")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit follow-up" }));

    const dueDate = screen.getByLabelText("Due date");
    const kind = screen.getByLabelText("Follow-up type");
    expect(dueDate).toHaveValue("2026-08-20");
    expect(kind).toHaveValue("call");
    expect(screen.queryByLabelText("Outcome")).not.toBeInTheDocument();

    fireEvent.change(dueDate, { target: { value: "2026-08-22" } });
    fireEvent.change(kind, { target: { value: "prepare_quote" } });
    expect(dueDate).toHaveValue("2026-08-22");
    expect(kind).toHaveValue("prepare_quote");

    fireEvent.click(screen.getByLabelText("Completed"));
    expect(screen.getByLabelText("Outcome")).toBeRequired();
  });

  it("saves the edited follow-up and reports the returned record", async () => {
    const onChanged = vi.fn();
    const updated = {
      ...followUp,
      kind: "send_information",
      dueAt: new Date("2026-08-22T17:00:00.000Z"),
      completedAt: new Date("2026-08-14T17:00:00.000Z"),
      outcome: "Sent the rate sheet",
    };
    editFollowUpAction.mockResolvedValue({ ok: true, followUp: updated });
    render(<FollowUpControls followUp={followUp} onChanged={onChanged} onDeleted={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit follow-up" }));
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-08-22" } });
    fireEvent.change(screen.getByLabelText("Follow-up type"), {
      target: { value: "send_information" },
    });
    fireEvent.click(screen.getByLabelText("Completed"));
    fireEvent.change(screen.getByLabelText("Outcome"), {
      target: { value: "Sent the rate sheet" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));

    await waitFor(() => expect(editFollowUpAction).toHaveBeenCalledTimes(1));
    const input = editFollowUpAction.mock.calls[0]![0];
    expect(input).toMatchObject({
      followUpId: followUp.id,
      kind: "send_information",
      completed: true,
      outcome: "Sent the rate sheet",
    });
    expect(input.dueAt).toBe("2026-08-22");
    expect(onChanged).toHaveBeenCalledWith(updated);
    expect(screen.queryByLabelText("Due date")).not.toBeInTheDocument();
  });

  it("confirms deletion, deletes once, and reports a successful removal", async () => {
    const onDeleted = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteFollowUpAction.mockResolvedValue({ ok: true });
    render(<FollowUpControls followUp={followUp} onChanged={vi.fn()} onDeleted={onDeleted} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete follow-up" }));

    expect(confirm).toHaveBeenCalledWith(
      "Delete this follow-up permanently? Calls, contacts, profiles, bookings, and other follow-ups will remain.",
    );
    await waitFor(() => expect(deleteFollowUpAction).toHaveBeenCalledTimes(1));
    expect(deleteFollowUpAction).toHaveBeenCalledWith(followUp.id);
    expect(onDeleted).toHaveBeenCalledWith(followUp.id);
  });

  it("keeps the follow-up visible and reports an inline deletion error", async () => {
    const onDeleted = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteFollowUpAction.mockResolvedValue({ ok: false, error: "Could not delete follow-up." });
    render(
      <article aria-label="Follow-up card">
        <FollowUpControls followUp={followUp} onChanged={vi.fn()} onDeleted={onDeleted} />
      </article>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete follow-up" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete follow-up.");
    expect(screen.getByRole("article", { name: "Follow-up card" })).toBeVisible();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("shows an inline save error without reporting a change", async () => {
    const onChanged = vi.fn();
    editFollowUpAction.mockResolvedValue({ ok: false, error: "Could not update follow-up." });
    render(<FollowUpControls followUp={followUp} onChanged={onChanged} onDeleted={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit follow-up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not update follow-up.");
    expect(screen.getByLabelText("Due date")).toBeVisible();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
