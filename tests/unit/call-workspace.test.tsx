// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CallWorkspace } from "@/components/calls/call-workspace";
import type { ActivityTimelineItem } from "@/features/activities/activity-types";
import type { CompleteCallInput } from "@/features/calls/call-types";

afterEach(cleanup);

const timeline: ActivityTimelineItem[] = [
  {
    id: "activity-1",
    organizationId: "11111111-1111-4111-8111-111111111111",
    contactId: "22222222-2222-4222-8222-222222222222",
    bookingId: "33333333-3333-4333-8333-333333333333",
    kind: "note",
    body: "Sent availability information.",
    occurredAt: new Date("2026-07-27T15:00:00Z"),
    createdAt: new Date("2026-07-27T15:00:00Z"),
    updatedAt: new Date("2026-07-27T15:00:00Z"),
    revisionCount: 0,
  },
];

const workspace = {
  organization: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Marias Fair",
    lastResort: true,
    lastResortReason: "Repeated cancellations.",
  },
  contact: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Avery Example",
    phone: "406-555-0101",
    email: "avery@example.com",
  },
  booking: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Marias Fair 2026",
    city: "Shelby",
    region: "MT",
    status: "interested" as const,
    startsAt: new Date("2026-08-08T17:00:00Z"),
  },
  followUpId: "44444444-4444-4444-8444-444444444444",
  timeline,
};

describe("CallWorkspace", () => {
  it("keeps a failed call entry intact while showing the required context and approved choices", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn<
      (input: CompleteCallInput) => Promise<{ ok: true } | { ok: false; error: string }>
    >().mockResolvedValue({
      ok: false,
      error: "Choose a next action and date before completing this call.",
    });

    render(<CallWorkspace {...workspace} onComplete={onComplete} />);

    expect(screen.getByRole("heading", { name: "Call Workspace" })).toBeVisible();
    expect(screen.getByText("Avery Example")).toBeVisible();
    expect(screen.getByText("Marias Fair 2026")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Marias Fair is marked Last Resort");
    expect(screen.getByText("Sent availability information.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open full contact record" })).toHaveAttribute(
      "href",
      "/contacts/22222222-2222-4222-8222-222222222222",
    );
    expect(screen.getByRole("link", { name: "Open full booking record" })).toHaveAttribute(
      "href",
      "/bookings/33333333-3333-4333-8333-333333333333",
    );
    expect(screen.getByRole("link", { name: "Open full organization record" })).toHaveAttribute(
      "href",
      "/organizations/11111111-1111-4111-8111-111111111111",
    );
    expect(screen.queryByLabelText("Call disposition")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Call note" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start call note" }));
    expect(within(screen.getByLabelText("Call disposition")).getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual([
      "no_answer",
      "left_voicemail",
      "follow_up_needed",
      "interested",
      "proposal_contract_sent",
      "booked",
      "declined",
      "move_to_last_resort",
    ]);
    await user.type(screen.getByLabelText("Call note"), "Asked for a proposal by Friday.");
    await user.selectOptions(screen.getByLabelText("Call disposition"), "follow_up_needed");
    await user.selectOptions(screen.getByLabelText("Next action"), "prepare_quote");
    await user.type(screen.getByLabelText("Next action date"), "2026-08-01");
    await user.click(screen.getByRole("button", { name: "Save call note" }));

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      note: "Asked for a proposal by Friday.",
      disposition: "follow_up_needed",
      nextAction: expect.objectContaining({ kind: "prepare_quote" }),
    }));
    expect(screen.getByText("Choose a next action and date before completing this call.")).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText("Call note")).toHaveValue("Asked for a proposal by Friday.");
    expect(screen.getByLabelText("Next action")).toHaveValue("prepare_quote");
    expect(screen.getByLabelText("Next action date")).toHaveValue("2026-08-01");
  });

  it("confirms a saved call and removes the submit path after a successful completion", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn<
      (input: CompleteCallInput) => Promise<{ ok: true } | { ok: false; error: string }>
    >().mockResolvedValue({ ok: true });

    render(<CallWorkspace {...workspace} onComplete={onComplete} />);

    await user.click(screen.getByRole("button", { name: "Start call note" }));
    await user.type(screen.getByLabelText("Call note"), "Confirmed the event details.");
    await user.click(screen.getByRole("button", { name: "Save call note" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Call note saved.");
    expect(screen.queryByRole("button", { name: "Save call note" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to Today" })).toHaveAttribute("href", "/today");
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
