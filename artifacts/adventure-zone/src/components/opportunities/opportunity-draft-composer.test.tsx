import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiPatch, apiPost } from "@/lib/auth-token";
import { OpportunityDraftComposer } from "./opportunity-draft-composer";

vi.mock("@/lib/auth-token", () => ({
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
}));

const draft = {
  id: "30000000-0000-4000-8000-000000000001",
  opportunityId: "10000000-0000-4000-8000-000000000001",
  organizationId: "20000000-0000-4000-8000-000000000001",
  contactId: null,
  eventYear: 2026,
  purpose: "new_outreach" as const,
  state: "draft" as const,
  gmailDraftId: "gmail-draft-1",
  gmailMessageId: "gmail-message-1",
  gmailThreadId: null,
  recipientEmail: "booking@example.com",
  recipientName: "Casey Organizer",
  subject: "Adventure Zone for Sample Fair",
  body: "Original body",
  scheduledFor: null,
  sentAt: null,
  lastFailureCode: null,
  lastFailureMessage: null,
  createdAt: "2026-08-27T14:00:00.000Z",
  updatedAt: "2026-08-27T14:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiPatch).mockResolvedValue({ draft: { ...draft, subject: "Edited subject", body: "Edited body" } });
  vi.mocked(apiPost).mockImplementation(async (path: string) => {
    if (path.endsWith("/rewrite")) {
      return {
        draft: { ...draft, subject: "AI subject", body: "AI body" },
        undoSubject: "Manual subject",
        undoBody: "Manual body",
      };
    }
    if (path.endsWith("/send")) {
      return { draft: { ...draft, state: "sent" }, followUpReferenceAt: "2026-08-27T15:00:00.000Z" };
    }
    return { draft };
  });
});

describe("OpportunityDraftComposer", () => {
  it("edits and saves the current subject/body without opening a follow-up prompt", async () => {
    render(<OpportunityDraftComposer draft={draft} fromAccount="zone@example.com" />);

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Edited subject" } });
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Edited body" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith(
      `/opportunities/${draft.opportunityId}/draft`,
      { draftId: draft.id, subject: "Edited subject", body: "Edited body" },
    ));
    expect(screen.queryByText("Follow up if no reply?")).not.toBeInTheDocument();
  });

  it.each([
    ["Shorter", "shorter"],
    ["More casual", "more_casual"],
    ["More direct", "more_direct"],
    ["Rewrite opening", "rewrite_opening"],
    ["More personal", "more_personal"],
    ["Stronger follow-up", "stronger_follow_up"],
    ["Fix wording", "fix_wording"],
  ])("runs %s against the current manual text", async (label, action) => {
    render(<OpportunityDraftComposer draft={draft} fromAccount="zone@example.com" />);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Manual subject" } });
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Manual body" } });

    fireEvent.click(screen.getByRole("button", { name: label }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
      `/opportunities/${draft.opportunityId}/draft/rewrite`,
      { draftId: draft.id, action, subject: "Manual subject", body: "Manual body" },
    ));
    expect(screen.getByLabelText("Subject")).toHaveValue("AI subject");
    expect(screen.getByLabelText("Body")).toHaveValue("AI body");
  });

  it("undoes only the immediately previous AI quick action", async () => {
    render(<OpportunityDraftComposer draft={draft} fromAccount="zone@example.com" />);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Manual subject" } });
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Manual body" } });
    fireEvent.click(screen.getByRole("button", { name: "Shorter" }));
    await screen.findByDisplayValue("AI subject");

    fireEvent.click(screen.getByRole("button", { name: "Undo AI change" }));

    expect(screen.getByLabelText("Subject")).toHaveValue("Manual subject");
    expect(screen.getByLabelText("Body")).toHaveValue("Manual body");
  });

  it("shows From/To/state/failure context and returns a follow-up reference after send", async () => {
    const onOutreachComplete = vi.fn();
    render(<OpportunityDraftComposer
      draft={{ ...draft, state: "failed", lastFailureMessage: "Gmail temporarily unavailable" }}
      fromAccount="zone@example.com"
      onOutreachComplete={onOutreachComplete}
    />);

    expect(screen.getByText("zone@example.com")).toBeInTheDocument();
    expect(screen.getByText("booking@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Gmail temporarily unavailable/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onOutreachComplete).toHaveBeenCalledWith({
      kind: "sent",
      referenceAt: "2026-08-27T15:00:00.000Z",
    }));
  });
});
