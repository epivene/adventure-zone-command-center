import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LeadEmailPreviewPanel } from "./lead-email-preview";

afterEach(cleanup);

const readyPreview = {
  sourceRowId: "row-1",
  rowVersion: 7,
  snapshotVersion: 7,
  verifiedDateRange: { startDate: "2026-09-29", endDate: "2026-10-04" },
  recipient: "person@example.com",
  profileName: "Aspen Filmfest",
  eventName: "Aspen Filmfest",
  relationshipStatus: "new_introduction",
  territoryStatus: "open",
  fitStatus: "approved",
  templateStatus: "approved" as const,
  templateVersion: "2026-prepaid-v1",
  templateSource: "ADVENTURE ZONE STICKY NOTES.docx.pdf",
  calendarEvidence: [],
  calendarConflictSummary: { totalConflicts: 0, totalEvidenceRecords: 0, displayedEvidenceRecords: 0, truncated: false },
  normalPackageCounts: [{ packageKey: "adventure_zone", availableQuantity: 1 }],
  readiness: { ready: true, blockers: [] },
  subject: "Subject",
  body: "Body",
};

describe("LeadEmailPreviewPanel Gmail draft action", () => {
  it("offers one individual Create Gmail Draft action only after a ready server preview", async () => {
    const create = vi.fn(async () => ({
      reused: false,
      link: { id: "link-1", state: "created", gmailDraftId: "gmail-draft-1", gmailMessageId: "message-1" },
    }));
    render(
      <LeadEmailPreviewPanel
        rowId="row-1"
        reviewVersion={7}
        load={async () => readyPreview}
        create={create}
      />,
    );

    expect(screen.queryByRole("button", { name: "Create Gmail Draft" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load safe preview" }));
    expect(await screen.findByText("Body")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create Gmail Draft" }));
    expect(await screen.findByText("Gmail draft created")).toBeInTheDocument();
    expect(create).toHaveBeenCalledWith("row-1", 7);
    expect(screen.queryByRole("button", { name: /bulk/i })).not.toBeInTheDocument();
  });

  it("does not expose draft creation for a blocked preview", async () => {
    render(
      <LeadEmailPreviewPanel
        rowId="row-1"
        reviewVersion={7}
        load={async () => ({ ...readyPreview, readiness: { ready: false, blockers: ["do_not_send"] }, subject: null, body: null })}
        create={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load safe preview" }));
    expect(await screen.findByText(/copy is withheld/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Gmail Draft" })).not.toBeInTheDocument();
  });
});
