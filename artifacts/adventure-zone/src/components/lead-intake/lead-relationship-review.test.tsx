import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LeadImportReviewRow } from "@/features/lead-intake/lead-intake-client";
import { LeadRelationshipReview } from "./lead-relationship-review";

afterEach(cleanup);

const row: LeadImportReviewRow = {
  id: "row-1", sheetName: "CompanyList", sourceRowNumber: 2, company: "Aspen Filmfest",
  phone: null, address1: null, address2: null, city: "Aspen", region: "CO", postalCode: null,
  website: null, industry: null, warnings: [], state: "verified", reviewVersion: 2,
  selectedOrganizationId: "org-1", selectedContactId: null, contactMode: "organization_inbox",
  confirmedEventName: "Aspen Filmfest (Aspen) CO", confirmedStartDate: "2026-09-29",
  confirmedEndDate: "2026-10-04", confirmedContactName: null, confirmedContactRole: null,
  confirmedRecipientEmail: "events@aspenfilm.org", recipientConfirmed: true,
  introductionSuitable: true, evidence: [], relationshipOutcome: "returning_contact",
  relationshipAnchorAt: "2026-08-25T18:00:00.000Z", relationshipCutoffDate: "2023-08-25",
  relationshipEvidenceIds: ["gmail:message-1"], latestOutboundAt: "2025-05-13T12:00:00.000Z",
  latestVerifiedResponseAt: "2025-05-14T12:00:00.000Z", relationshipReviewRequired: false,
  relationshipClassifiedAt: "2026-08-25T18:00:00.000Z", relationshipClassifiedBy: "Desiree",
};

describe("LeadRelationshipReview", () => {
  it("shows the deterministic returning-contact style and auditable source reference", () => {
    render(<LeadRelationshipReview client={{ classifyRelationship: vi.fn() }} onClassified={vi.fn()} row={row} />);
    expect(screen.getByText(/Returning contact: verified reply on May 14, 2025/)).toBeInTheDocument();
    expect(screen.getByText("Returning contact email")).toBeInTheDocument();
    expect(screen.getByText("Gmail")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Supporting source"));
    expect(screen.getByText("gmail:message-1")).toBeInTheDocument();
    expect(screen.getByText("Hi,")).toBeInTheDocument();
  });

  it("blocks a normal email style when history needs review", () => {
    render(<LeadRelationshipReview
      client={{ classifyRelationship: vi.fn() }}
      onClassified={vi.fn()}
      row={{ ...row, relationshipOutcome: "needs_review", relationshipReviewRequired: true }}
    />);
    expect(screen.getByText(/Previous contact needs review/)).toBeInTheDocument();
    expect(screen.queryByText(/email$/i)).not.toBeInTheDocument();
  });

  it("classifies a verified row using its current review version", async () => {
    const classifyRelationship = vi.fn().mockResolvedValue({ rowId: "row-1", reviewVersion: 3 });
    const onClassified = vi.fn();
    render(<LeadRelationshipReview
      client={{ classifyRelationship }}
      onClassified={onClassified}
      row={{ ...row, relationshipOutcome: null, relationshipEvidenceIds: [], relationshipClassifiedAt: null }}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Check previous contact" }));
    await waitFor(() => expect(classifyRelationship).toHaveBeenCalledWith("row-1", 2));
    expect(onClassified).toHaveBeenCalled();
  });
});
