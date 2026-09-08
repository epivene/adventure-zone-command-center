import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoiNextAction } from "./coi-next-action";

const retry = vi.hoisted(() => vi.fn());
vi.mock("@/features/contracts/contract-client", () => ({ contractClient: { retryCoiDraft: retry } }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); retry.mockResolvedValue({ coiDraft: { state: "created" } }); });

describe("CoiNextAction", () => {
  it("opens a created editable Gmail draft and shows how to find it", () => {
    render(<CoiNextAction contractVersionId="version-1" coiDraft={{ state: "created", recipientEmail: "sara@protectiveins.net", subject: "COI Request for Event", gmailMessageId: "message-1" }} onRefresh={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Review COI draft" })).toHaveAttribute("href", "https://mail.google.com/mail/u/0/#drafts/message-1");
    expect(screen.getByText("sara@protectiveins.net")).toBeInTheDocument();
    expect(screen.getByText("COI Request for Event")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
  });

  it("shows details-needed, retryable, and manual-review recovery without a Send action", async () => {
    const refreshed = vi.fn();
    const page = render(<CoiNextAction contractVersionId="version-1" coiDraft={{ state: "details_needed" }} onRefresh={refreshed} />);
    expect(screen.getByText("COI details needed")).toBeInTheDocument();
    page.rerender(<CoiNextAction contractVersionId="version-1" coiDraft={{ state: "retryable_error" }} onRefresh={refreshed} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry COI draft" }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith("version-1"));
    expect(refreshed).toHaveBeenCalled();
    page.rerender(<CoiNextAction contractVersionId="version-1" coiDraft={{ state: "manual_review" }} onRefresh={refreshed} />);
    expect(screen.getByText(/Check Gmail before retrying/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
  });
});
