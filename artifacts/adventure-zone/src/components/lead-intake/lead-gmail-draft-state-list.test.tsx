import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LeadGmailDraftStateList } from "./lead-gmail-draft-state-list";

afterEach(cleanup);

describe("LeadGmailDraftStateList", () => {
  it("shows linked lead Gmail draft state separately without calling it sent", () => {
    render(<LeadGmailDraftStateList drafts={[{
      id: "link-1",
      rowId: "row-1",
      profileName: "Aspen Filmfest (Aspen) CO",
      recipientEmail: "person@example.com",
      subject: "Aspen Filmfest (Aspen) CO SEPT 29 – OCT 4, 2026",
      state: "created",
      gmailDraftId: "gmail-draft-1",
      lastErrorCode: null,
      updatedAt: "2026-08-26T12:00:00.000Z",
    }]} />);

    expect(screen.getByRole("heading", { name: "Lead Gmail drafts" })).toBeInTheDocument();
    expect(screen.getByText("Gmail draft created")).toBeInTheDocument();
    expect(screen.queryByText(/^Sent$/i)).not.toBeInTheDocument();
  });
});
