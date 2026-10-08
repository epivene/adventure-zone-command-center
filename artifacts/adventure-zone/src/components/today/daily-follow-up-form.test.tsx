import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const create = vi.hoisted(() => vi.fn());
const edit = vi.hoisted(() => vi.fn());
vi.mock("@/actions/follow-ups", () => ({ createFollowUpAction: create, editFollowUpAction: edit }));
import { DailyFollowUpForm } from "./daily-follow-up-form";
import type { DailyWork } from "@/features/today/daily-work";
const work: DailyWork = {
  id: "lead", name: "Fair", kind: "Lead", reason: "No reminder", href: "/profiles/org",
  dueAt: null, organizationId: "org", contactId: "contact", bookingId: "booking", location: "CO",
};
afterEach(() => { cleanup(); create.mockReset(); edit.mockReset(); });
describe("daily reminder form", () => {
  it("saves the linked record with a business date and refreshes the queue", async () => {
    create.mockResolvedValue({ ok: true, followUp: {} });
    const saved = vi.fn().mockResolvedValue(undefined);
    render(<DailyFollowUpForm work={work} onSaved={saved} onCancel={() => {}} onBusyChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Reminder date"), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith({ organizationId: "org", contactId: "contact", bookingId: "booking", kind: "email", dueAt: expect.any(Date) });
    expect(edit).not.toHaveBeenCalled();
  });
  it("does not pretend a failed save succeeded or clear the user's input", async () => {
    create.mockResolvedValue({ ok: false, error: "Unable to save" });
    const saved = vi.fn();
    render(<DailyFollowUpForm work={work} onSaved={saved} onCancel={() => {}} onBusyChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Reminder date"), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save");
    expect(screen.getByLabelText("Reminder date")).toHaveValue("2026-10-20");
    expect(saved).not.toHaveBeenCalled();
  });
  it("disables incomplete saves and allows cancellation", () => {
    const cancel = vi.fn();
    render(<DailyFollowUpForm work={work} onSaved={vi.fn()} onCancel={cancel} onBusyChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Save follow-up" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });
});
