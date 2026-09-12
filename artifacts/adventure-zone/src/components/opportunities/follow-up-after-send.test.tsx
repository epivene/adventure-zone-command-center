import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiPost } from "@/lib/auth-token";
import { FollowUpAfterSend } from "./follow-up-after-send";

vi.mock("@/lib/auth-token", () => ({ apiPost: vi.fn() }));

const opportunityId = "10000000-0000-4000-8000-000000000001";
const referenceAt = "2026-08-27T15:00:00.000Z";

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiPost).mockResolvedValue({
    ok: true,
    followUp: { id: "40000000-0000-4000-8000-000000000001" },
  });
});

describe("FollowUpAfterSend", () => {
  it.each([
    ["3 days", 3],
    ["7 days", 7],
  ])("creates one Opportunity follow-up %s after the delivery reference", async (label, days) => {
    const onDone = vi.fn();
    render(<FollowUpAfterSend opportunityId={opportunityId} referenceAt={referenceAt} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: label }));

    const dueAt = new Date(referenceAt);
    dueAt.setUTCDate(dueAt.getUTCDate() + days);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/follow-ups", {
      opportunityId,
      kind: "email",
      dueAt: dueAt.toISOString(),
    }));
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("offers common reasons and defaults 2027 outreach for a 2027 draft", async () => {
    render(
      <FollowUpAfterSend
        opportunityId={opportunityId}
        referenceAt={referenceAt}
        eventYear={2027}
      />,
    );

    const reason = screen.getByLabelText("Follow-up reason");
    expect(reason).toHaveValue("2027_outreach");
    for (const label of [
      "2027 outreach",
      "Post-event feedback",
      "Convention reply check",
      "Proposal / contract",
      "Application deadline",
      "Deposit / payment",
      "Awaiting decision",
      "Contact repair",
    ]) {
      expect(screen.getByRole("option", { name: label })).toBeVisible();
    }

    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    const dueAt = new Date(referenceAt);
    dueAt.setUTCDate(dueAt.getUTCDate() + 7);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/follow-ups", {
      opportunityId,
      kind: "2027_outreach",
      dueAt: dueAt.toISOString(),
    }));
  });

  it("creates a custom future follow-up", async () => {
    render(<FollowUpAfterSend opportunityId={opportunityId} referenceAt={referenceAt} />);
    const customValue = "2026-09-05T10:30";

    fireEvent.change(screen.getByLabelText("Follow-up date and time"), {
      target: { value: customValue },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set custom follow-up" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/follow-ups", {
      opportunityId,
      kind: "email",
      dueAt: new Date(customValue).toISOString(),
    }));
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it("creates nothing when No follow-up is selected", () => {
    const onDone = vi.fn();
    render(<FollowUpAfterSend opportunityId={opportunityId} referenceAt={referenceAt} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "No follow-up" }));

    expect(apiPost).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
