import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeadContactDateReview } from "./lead-contact-date-review";

afterEach(cleanup);

const row = {
  id: "row-1", sheetName: "CompanyList", sourceRowNumber: 2, company: "Aspen Filmfest",
  phone: null, address1: null, address2: null, city: "Aspen", region: "CO", postalCode: null,
  website: "aspenfilm.org", industry: null, warnings: [], state: "needs_review" as const,
  reviewVersion: 0, selectedOrganizationId: null, selectedContactId: null, contactMode: null,
  confirmedEventName: null, confirmedStartDate: null, confirmedEndDate: null,
  confirmedContactName: null, confirmedContactRole: null, confirmedRecipientEmail: null,
  recipientConfirmed: false, introductionSuitable: false, evidence: [],
};

function client() {
  return {
    searchProfiles: vi.fn().mockResolvedValue([{ id: "org-1", name: "Aspen Filmfest (Aspen) CO", city: "Aspen", region: "CO" }]),
    listProfileContacts: vi.fn().mockResolvedValue([{ id: "contact-1", firstName: "Lindsey", lastName: "Powell", email: "lilupow@aspenfilm.org", role: "Event organizer", jobTitle: null }]),
    confirmReview: vi.fn().mockResolvedValue({ rowId: "row-1", state: "verified", reviewVersion: 1 }),
  };
}

describe("LeadContactDateReview", () => {
  it("does not enable verification for a suggested recipient until both confirmations are checked", async () => {
    const api = client();
    render(<LeadContactDateReview client={api} onSaved={vi.fn()} row={row} />);
    fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));
    fireEvent.click(await screen.findByRole("button", { name: /Aspen Filmfest \(Aspen\) CO/ }));
    fireEvent.change(await screen.findByLabelText("Existing contact"), { target: { value: "contact-1" } });
    fireEvent.change(screen.getByLabelText("Event start date"), { target: { value: "2026-09-29" } });
    fireEvent.change(screen.getByLabelText("Event end date"), { target: { value: "2026-10-04" } });
    fireEvent.change(screen.getByLabelText("Date source"), { target: { value: "https://aspenfilm.org/festival" } });
    expect(screen.getByRole("button", { name: "Verify event and contact" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("I confirmed this recipient email"));
    fireEvent.click(screen.getByLabelText("This contact is appropriate for an introduction email"));
    expect(screen.getByRole("button", { name: "Verify event and contact" })).toBeEnabled();
  });

  it("submits the selected profile, contact role, dates, recipient, evidence, and row version", async () => {
    const api = client();
    const onSaved = vi.fn();
    render(<LeadContactDateReview client={api} onSaved={onSaved} row={row} />);
    fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));
    fireEvent.click(await screen.findByRole("button", { name: /Aspen Filmfest \(Aspen\) CO/ }));
    fireEvent.change(await screen.findByLabelText("Existing contact"), { target: { value: "contact-1" } });
    fireEvent.change(screen.getByLabelText("Event start date"), { target: { value: "2026-09-29" } });
    fireEvent.change(screen.getByLabelText("Event end date"), { target: { value: "2026-10-04" } });
    fireEvent.change(screen.getByLabelText("Date source"), { target: { value: "https://aspenfilm.org/festival" } });
    fireEvent.click(screen.getByLabelText("I confirmed this recipient email"));
    fireEvent.click(screen.getByLabelText("This contact is appropriate for an introduction email"));
    fireEvent.click(screen.getByRole("button", { name: "Verify event and contact" }));

    await waitFor(() => expect(api.confirmReview).toHaveBeenCalledWith("row-1", expect.objectContaining({
      expectedVersion: 0,
      decision: expect.objectContaining({
        organizationId: "org-1", contactId: "contact-1", contactRole: "Event organizer",
        recipientEmail: "lilupow@aspenfilm.org", startDate: "2026-09-29", endDate: "2026-10-04",
        recipientConfirmed: true, introductionSuitable: true,
      }),
    })));
    expect(onSaved).toHaveBeenCalled();
  });
});
