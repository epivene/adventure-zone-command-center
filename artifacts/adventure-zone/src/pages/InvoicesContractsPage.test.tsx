import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BusinessDocumentRecord } from "@/lib/business-documents-api";
import InvoicesContractsPage from "./InvoicesContractsPage";

function contractDocument(
  id: string,
  name: string,
  event: string,
  filename = `${name}.pdf`,
  overrides: Partial<BusinessDocumentRecord> = {},
): BusinessDocumentRecord {
  return {
    id,
    displayName: name,
    originalFilename: filename,
    category: "contract",
    lifecycle: "active",
    reviewState: "accepted",
    currentVersionId: `version-${id}`,
    effectiveDate: null,
    issueDate: "2026-09-22",
    expirationDate: null,
    notes: null,
    sourceKinds: ["manual"],
    createdAt: "2026-09-22T16:00:00.000Z",
    updatedAt: "2026-09-22T16:00:00.000Z",
    fileAvailable: true,
    links: [{ id: `link-${id}`, targetKind: "profile", targetId: `org-${event}`, targetLabel: event }],
    ...overrides,
  };
}

describe("InvoicesContractsPage", () => {
  it("shows invoice attention counts and mobile-safe cards", async () => {
    const invoiceApi = {
      list: vi.fn().mockResolvedValue({ invoices: [{
        id: "invoice-1", organizationId: "org-1", organizationName: "Kamiah BBQ Days",
        bookingId: null, bookingName: null, documentId: "doc-1", documentName: "Invoice",
        invoiceNumber: "AZ-2027-001", status: "deposit_paid", storedStatus: "deposit_paid",
        effectiveStatus: "deposit_paid", currency: "USD", totalCents: 750000, depositCents: 300000,
        paidCents: 300000, remainingCents: 450000, creditCents: 0, issueDate: "2026-09-15",
        depositDueDate: null, balanceDueDate: "2027-09-03", nextDueDate: "2027-09-03",
        notes: null, payments: [],
      }] }),
      summary: vi.fn().mockResolvedValue({ summary: { totalInvoices: 1, overdueCount: 0, overdueCents: 0, depositDueCount: 0, outstandingCents: 450000 } }),
      detail: vi.fn(), create: vi.fn(), update: vi.fn(), recordPayment: vi.fn(), voidPayment: vi.fn(),
    };
    render(<InvoicesContractsPage
      invoiceApi={invoiceApi}
      contractApi={{ list: vi.fn().mockResolvedValue({ contracts: [] }) }}
      documentApi={{ upload: vi.fn(), deleteDocument: vi.fn(), open: vi.fn(), searchProfiles: vi.fn(), list: vi.fn(), listAll: vi.fn().mockResolvedValue({ documents: [] }) }}
    />);
    expect(await screen.findByText("Overdue balances")).toBeInTheDocument();
    expect(screen.getByText("$4,500.00 remaining")).toBeInTheDocument();
    expect(screen.getByTestId("invoice-card")).toHaveClass("grid");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows uploaded contract documents when no lifecycle record exists", async () => {
    const open = vi.fn().mockResolvedValue("https://example.test/contract.pdf");
    const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
    const documentApi = {
      upload: vi.fn(),
      deleteDocument: vi.fn(),
      open,
      searchProfiles: vi.fn(),
      list: vi.fn(),
      listAll: vi.fn().mockResolvedValue({
        documents: [{
          id: "contract-document-1",
          displayName: "Fairplay Burro Days 2027 Signed Contract",
          originalFilename: "Fairplay_Burro_Days_2027_Signed_Contract.pdf",
          category: "contract" as const,
          lifecycle: "active" as const,
          reviewState: "accepted" as const,
          currentVersionId: "version-1",
          effectiveDate: null,
          issueDate: null,
          expirationDate: null,
          notes: null,
          sourceKinds: ["manual" as const],
          createdAt: "2026-09-22T16:00:00.000Z",
          updatedAt: "2026-09-22T16:00:00.000Z",
          fileAvailable: true,
          links: [{ id: "link-1", targetKind: "profile" as const, targetId: "org-1", targetLabel: "Fairplay Burro Days" }],
        }],
      }),
    };
    const invoiceApi = {
      list: vi.fn().mockResolvedValue({ invoices: [] }),
      summary: vi.fn().mockResolvedValue({ summary: { totalInvoices: 0, overdueCount: 0, overdueCents: 0, depositDueCount: 0, outstandingCents: 0 } }),
      detail: vi.fn(), create: vi.fn(), update: vi.fn(), recordPayment: vi.fn(), voidPayment: vi.fn(),
    };

    render(<InvoicesContractsPage
      invoiceApi={invoiceApi}
      contractApi={{ list: vi.fn().mockResolvedValue({ contracts: [] }) }}
      documentApi={documentApi}
    />);

    expect(await screen.findByText("Fairplay Burro Days 2027 Signed Contract")).toBeInTheDocument();
    expect(screen.getByText("Fairplay Burro Days", { selector: "p" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("contract-document-1"));
    expect(openWindow).toHaveBeenCalledWith("https://example.test/contract.pdf", "_blank", "noopener,noreferrer");
    openWindow.mockRestore();
  });

  it("defaults to the newest year, excludes old invoices from totals, and filters contracts by event", async () => {
    const invoiceApi = {
      list: vi.fn().mockResolvedValue({ invoices: [
        {
          id: "invoice-2027", organizationId: "org-kamiah", organizationName: "Kamiah BBQ Days",
          bookingId: null, bookingName: null, documentId: "doc-2027", documentName: "Kamiah 2027 Invoice",
          invoiceNumber: "AZ-2027-KAMIAH", status: "deposit_paid", storedStatus: "deposit_paid",
          effectiveStatus: "deposit_paid", currency: "USD", totalCents: 750000, depositCents: 300000,
          paidCents: 300000, remainingCents: 450000, creditCents: 0, issueDate: "2026-09-15",
          depositDueDate: null, balanceDueDate: "2027-09-03", nextDueDate: "2027-09-03",
          notes: null, payments: [],
        },
        {
          id: "invoice-2024", organizationId: "org-old", organizationName: "Old County Fair",
          bookingId: null, bookingName: null, documentId: "doc-2024", documentName: "Old County Fair 2024 Invoice",
          invoiceNumber: "AZ-2024-OLD", status: "sent", storedStatus: "sent",
          effectiveStatus: "overdue", currency: "USD", totalCents: 1000000, depositCents: 0,
          paidCents: 0, remainingCents: 1000000, creditCents: 0, issueDate: "2024-01-10",
          depositDueDate: null, balanceDueDate: "2024-08-01", nextDueDate: "2024-08-01",
          notes: null, payments: [],
        },
        {
          id: "invoice-cancelled-2027", organizationId: "org-cancelled", organizationName: "Cancelled 2027 Event",
          bookingId: null, bookingName: null, documentId: "doc-cancelled-2027", documentName: "Cancelled 2027 Invoice",
          invoiceNumber: "AZ-2027-CANCELLED", status: "cancelled", storedStatus: "cancelled",
          effectiveStatus: "cancelled", currency: "USD", totalCents: 2500000, depositCents: 0,
          paidCents: 0, remainingCents: 2500000, creditCents: 0, issueDate: "2026-09-15",
          depositDueDate: null, balanceDueDate: "2027-09-03", nextDueDate: null,
          notes: null, payments: [],
        },
        {
          id: "invoice-draft-2027", organizationId: "org-draft", organizationName: "Draft 2027 Event",
          bookingId: null, bookingName: null, documentId: "doc-draft-2027", documentName: "Draft 2027 Invoice",
          invoiceNumber: "AZ-2027-DRAFT", status: "draft", storedStatus: "draft",
          effectiveStatus: "draft", currency: "USD", totalCents: 1800000, depositCents: 0,
          paidCents: 0, remainingCents: 1800000, creditCents: 0, issueDate: "2026-09-15",
          depositDueDate: null, balanceDueDate: "2027-09-03", nextDueDate: null,
          notes: null, payments: [],
        },
      ] }),
      summary: vi.fn().mockResolvedValue({ summary: { totalInvoices: 2, overdueCount: 1, overdueCents: 1000000, depositDueCount: 0, outstandingCents: 1450000 } }),
      detail: vi.fn(), create: vi.fn(), update: vi.fn(), recordPayment: vi.fn(), voidPayment: vi.fn(),
    };
    render(<InvoicesContractsPage
      invoiceApi={invoiceApi}
      contractApi={{ list: vi.fn().mockResolvedValue({ contracts: [{
        id: "fairplay-workflow", organizationId: "org-fairplay", organizationName: "Town of Fairplay",
        bookingId: "booking-fairplay", bookingName: "Fairplay Burro Days", bookingStartsAt: "2027-07-23T16:00:00.000Z",
        status: "sent", versionNumber: 1, updatedAt: "2026-09-20T16:00:00.000Z",
      }] }) }}
      documentApi={{
        upload: vi.fn(), deleteDocument: vi.fn(), open: vi.fn(), searchProfiles: vi.fn(), list: vi.fn(),
        listAll: vi.fn().mockResolvedValue({ documents: [
          contractDocument("fairplay", "Fairplay Burro Days Contract", "Fairplay Burro Days", "Fairplay_Burro_Days_2027_Contract.pdf", {
            links: [{ id: "link-fairplay", targetKind: "profile", targetId: "org-fairplay", targetLabel: "Town of Fairplay" }],
          }),
          contractDocument("fairplay-signed", "Fairplay Burro Days 2027 Contract", "Fairplay Burro Days", "Fairplay_Burro_Days_2027_Signed_Contract.pdf", {
            links: [{ id: "link-fairplay-signed", targetKind: "profile", targetId: "org-fairplay", targetLabel: "Town of Fairplay" }],
          }),
          contractDocument("phillips", "Phillips County Fair 2027 Contract", "Phillips County Fair"),
          contractDocument("old", "Old County Fair 2024 Contract", "Old County Fair"),
          contractDocument("archived-future", "Future Fair 2028 Signed Contract", "Future Fair", undefined, { lifecycle: "archived" }),
        ] }),
      }}
    />);

    const year = await screen.findByLabelText("Year");
    expect(year).toHaveValue("2027");
    expect(screen.getByText("$4,500.00", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fairplay Burro Days 2027 Contract" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Fairplay Burro Days Contract" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Town of Fairplay" })).not.toBeInTheDocument();
    expect(screen.getByText("Signed contract")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Old County Fair 2024 Contract" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Event"), { target: { value: "Phillips County Fair" } });
    expect(screen.getByRole("heading", { name: "Phillips County Fair 2027 Contract" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Fairplay Burro Days Contract" })).not.toBeInTheDocument();
  });

  it("keeps ambiguous contract matches visible and selects one newest signed copy", async () => {
    const documents = [
      contractDocument("ambiguous-unsigned", "Ambiguous Fair 2027 Contract", "Ambiguous Fair"),
      contractDocument("ambiguous-signed", "Ambiguous Fair 2027 Signed Contract", "Ambiguous Fair", undefined, { reviewState: "needs_review" }),
      contractDocument("tie-a", "Tie Fair 2027 Signed Contract A", "Tie Fair"),
      contractDocument("tie-b", "Tie Fair 2027 Signed Contract B", "Tie Fair"),
      contractDocument("not-executed", "Pending Fair 2027 Not Executed Contract", "Pending Fair"),
      contractDocument("pending-unsigned", "Pending Fair 2027 Contract", "Pending Fair"),
      contractDocument("same-org-alpha-unsigned", "Alpha Days 2027 Contract", "Alpha Days", undefined, {
        links: [{ id: "link-alpha-unsigned", targetKind: "profile", targetId: "shared-org", targetLabel: "Shared Fair Board" }],
      }),
      contractDocument("same-org-alpha-signed", "Alpha Days 2027 Signed Contract", "Alpha Days", undefined, {
        links: [{ id: "link-alpha-signed", targetKind: "profile", targetId: "shared-org", targetLabel: "Shared Fair Board" }],
      }),
      contractDocument("same-org-beta", "Beta Days 2027 Contract", "Beta Days", undefined, {
        links: [{ id: "link-beta", targetKind: "profile", targetId: "shared-org", targetLabel: "Shared Fair Board" }],
      }),
      contractDocument("not-yet-signed", "Waiting Fair 2027 Not Yet Signed Contract", "Waiting Fair"),
      contractDocument("waiting-unsigned", "Waiting Fair 2027 Contract", "Waiting Fair"),
    ];
    const invoiceApi = {
      list: vi.fn().mockResolvedValue({ invoices: [] }), summary: vi.fn(), detail: vi.fn(), create: vi.fn(),
      update: vi.fn(), recordPayment: vi.fn(), voidPayment: vi.fn(),
    };

    render(<InvoicesContractsPage
      invoiceApi={invoiceApi}
      contractApi={{ list: vi.fn().mockResolvedValue({ contracts: [] }) }}
      documentApi={{
        upload: vi.fn(), deleteDocument: vi.fn(), open: vi.fn(), searchProfiles: vi.fn(), list: vi.fn(),
        listAll: vi.fn().mockResolvedValue({ documents }),
      }}
    />);

    expect(await screen.findByLabelText("Year")).toHaveValue("2027");
    expect(screen.getByRole("heading", { name: "Ambiguous Fair 2027 Contract" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ambiguous Fair 2027 Signed Contract" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tie Fair 2027 Signed Contract A" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tie Fair 2027 Signed Contract B" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pending Fair 2027 Not Executed Contract" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pending Fair 2027 Contract" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Alpha Days 2027 Contract" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Alpha Days 2027 Signed Contract" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Beta Days 2027 Contract" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Waiting Fair 2027 Not Yet Signed Contract" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Waiting Fair 2027 Contract" })).toBeInTheDocument();
  });
});
