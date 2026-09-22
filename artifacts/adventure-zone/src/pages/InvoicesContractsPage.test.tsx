import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InvoicesContractsPage from "./InvoicesContractsPage";

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
    expect(screen.getByText("Fairplay Burro Days")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("contract-document-1"));
    expect(openWindow).toHaveBeenCalledWith("https://example.test/contract.pdf", "_blank", "noopener,noreferrer");
    openWindow.mockRestore();
  });
});
