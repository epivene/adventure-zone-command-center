import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { LeadContactDateReview } from "./lead-contact-date-review";

afterEach(cleanup);

it("shows ACT evidence and a person-free organization inbox choice", async () => {
  const client = {
    searchProfiles: vi.fn().mockResolvedValue([{ id: "org-1", name: "Alamosa ARTs Festival (Alamosa) CO", city: "Alamosa", region: "CO" }]),
    listProfileContacts: vi.fn().mockResolvedValue([]),
    getProfileEvidence: vi.fn().mockResolvedValue({
      organization: { id: "org-1", name: "Alamosa ARTs Festival (Alamosa) CO", city: "Alamosa", region: "CO", phone: "(719) 937-2636", website: "https://www.societyhall.org/" },
      contacts: [],
      actText: [{ sourceRecordId: "source-1", sourceVersionId: "version-1", sourcePath: "$.Description", kind: "description", originalText: "Society Hall Annual Celebration | Societyhall@gmail.com", emails: ["societyhall@gmail.com"] }],
      emailCandidates: [{ email: "societyhall@gmail.com", sourceRecordId: "source-1", sourceVersionId: "version-1", sourcePath: "$.Description" }],
    }),
    confirmReview: vi.fn(),
  };
  const row = {
    id: "row-1", sheetName: "CompanyList", sourceRowNumber: 2, company: "Alamosa ARTs Festival",
    phone: null, address1: null, address2: null, city: "Alamosa", region: "CO", postalCode: null,
    website: null, industry: null, warnings: [], state: "needs_review" as const, reviewVersion: 0,
    selectedOrganizationId: null, selectedContactId: null, contactMode: null, confirmedEventName: null,
    confirmedStartDate: null, confirmedEndDate: null, confirmedContactName: null, confirmedContactRole: null,
    confirmedRecipientEmail: null, recipientConfirmed: false, introductionSuitable: false, evidence: [],
  };

  render(<LeadContactDateReview row={row} client={client} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));
  fireEvent.click(await screen.findByRole("button", { name: /Alamosa ARTs Festival/ }));

  expect(await screen.findByText(/Society Hall Annual Celebration/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Organization inbox" }));
  fireEvent.click(screen.getByRole("button", { name: "societyhall@gmail.com" }));
  expect(screen.getByText("Hi,")).toBeInTheDocument();
  expect(screen.queryByLabelText("Contact name")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Contact role")).not.toBeInTheDocument();
});
