import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InvoiceEditor } from "./invoice-editor";

describe("InvoiceEditor", () => {
  it("removes the uploaded document when invoice creation fails", async () => {
    const user = userEvent.setup();
    const invoiceApi = {
      create: vi.fn().mockRejectedValue(new Error("Invoice number already exists")),
      list: vi.fn(), summary: vi.fn(), detail: vi.fn(), update: vi.fn(), recordPayment: vi.fn(), voidPayment: vi.fn(),
    };
    const documentApi = {
      upload: vi.fn().mockResolvedValue({ documentId: "document-1" }),
      deleteDocument: vi.fn().mockResolvedValue({ ok: true }),
      searchProfiles: vi.fn().mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111", name: "Kamiah BBQ Days", city: "Kamiah", region: "ID" }]),
    };
    render(<InvoiceEditor api={invoiceApi} documentApi={documentApi} onCancel={vi.fn()} onCreated={vi.fn()} />);

    await user.upload(screen.getByLabelText("Invoice PDF"), new File(["pdf"], "invoice.pdf", { type: "application/pdf" }));
    await user.type(screen.getByLabelText("Profile"), "Kamiah");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: /Kamiah BBQ Days/ }));
    await user.type(screen.getByLabelText("Invoice number"), "AZ-2027-001");
    await user.type(screen.getByLabelText("Total amount"), "7500");
    await user.click(screen.getByRole("button", { name: "Save invoice" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invoice number already exists");
    expect(documentApi.deleteDocument).toHaveBeenCalledWith("document-1");
  });
});
