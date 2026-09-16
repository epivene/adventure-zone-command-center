import { render, screen } from "@testing-library/react";
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
      documentApi={{ upload: vi.fn(), deleteDocument: vi.fn(), open: vi.fn(), searchProfiles: vi.fn(), list: vi.fn() }}
    />);
    expect(await screen.findByText("Overdue balances")).toBeInTheDocument();
    expect(screen.getByText("$4,500.00 remaining")).toBeInTheDocument();
    expect(screen.getByTestId("invoice-card")).toHaveClass("grid");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
