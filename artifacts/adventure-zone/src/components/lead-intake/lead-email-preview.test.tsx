import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LeadEmailPreviewPanel } from "./lead-email-preview";

afterEach(cleanup);

function preview(rowId: string, rowVersion: number) {
  return {
    sourceRowId: rowId,
    rowVersion,
    snapshotVersion: rowVersion,
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
    calendarEvidence: [{ calendarId: "primary", eventId: "event-1", conflict: true }],
    normalPackageCounts: [{ packageKey: "adventure_zone", availableQuantity: 1 }],
    readiness: { ready: true, blockers: [] },
    subject: `Subject ${rowId}`,
    body: `Body ${rowId}`,
  };
}

describe("LeadEmailPreviewPanel safety state", () => {
  it("shows required server evidence and resets copy on row/version changes", async () => {
    const load = vi.fn(async (rowId: string, version: number) => preview(rowId, version));
    const view = render(<LeadEmailPreviewPanel rowId="row-a" reviewVersion={7} invalidationKey={0} load={load} />);

    fireEvent.click(screen.getByRole("button", { name: "Load safe preview" }));
    expect(await screen.findByText("Body row-a")).toBeInTheDocument();
    expect(screen.getByText("row-a")).toBeInTheDocument();
    expect(screen.getByText("Row 7 / snapshot 7")).toBeInTheDocument();
    expect(screen.getByText("new introduction / open / approved")).toBeInTheDocument();
    expect(screen.getByText("2026-prepaid-v1 — ADVENTURE ZONE STICKY NOTES.docx.pdf")).toBeInTheDocument();
    expect(screen.getByText("1 conflict across 1 sanitized record")).toBeInTheDocument();
    expect(screen.getByText("adventure_zone: 1")).toBeInTheDocument();

    view.rerender(<LeadEmailPreviewPanel rowId="row-b" reviewVersion={2} invalidationKey={0} load={load} />);
    expect(screen.queryByText("Body row-a")).not.toBeInTheDocument();
  });

  it("invalidates loaded copy after any successful safety mutation", async () => {
    const load = vi.fn(async (rowId: string, version: number) => preview(rowId, version));
    const view = render(<LeadEmailPreviewPanel rowId="row-a" reviewVersion={7} invalidationKey={0} load={load} />);
    fireEvent.click(screen.getByRole("button", { name: "Load safe preview" }));
    expect(await screen.findByText("Body row-a")).toBeInTheDocument();

    view.rerender(<LeadEmailPreviewPanel rowId="row-a" reviewVersion={7} invalidationKey={1} load={load} />);
    expect(screen.queryByText("Body row-a")).not.toBeInTheDocument();
  });
});
