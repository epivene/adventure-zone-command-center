import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InvoiceEditor } from "./invoice-editor";

describe("InvoiceEditor", () => {
  it("uses an invoice document already linked to the selected profile", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const invoiceApi = {
      create: vi.fn().mockResolvedValue({ invoice: { id: "invoice-1" } }),
      list: vi.fn(), summary: vi.fn(), detail: vi.fn(), update: vi.fn(), recordPayment: vi.fn(), voidPayment: vi.fn(),
    };
    const documentApi = {
      upload: vi.fn(),
      deleteDocument: vi.fn(),
      searchProfiles: vi.fn().mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111", name: "Kamiah BBQ Days", city: "Kamiah", region: "ID" }]),
      list: vi.fn().mockResolvedValue({ documents: [{ id: "document-1", displayName: "Kamiah BBQ Days 2027 Invoice" }] }),
    };
    render(<InvoiceEditor api={invoiceApi} documentApi={documentApi} onCancel={vi.fn()} onCreated={onCreated} />);

    await user.type(screen.getByLabelText("Profile"), "Kamiah");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: /Kamiah BBQ Days/ }));
    expect(await screen.findByLabelText("Existing invoice PDF")).toHaveValue("document-1");
    await user.type(screen.getByLabelText("Invoice number"), "AZ-2027-KAMIAH");
    await user.type(screen.getByLabelText("Total amount"), "7500");
    await user.type(screen.getByLabelText("Deposit amount"), "3000");
    await user.click(screen.getByRole("button", { name: "Save invoice" }));

    expect(invoiceApi.create).toHaveBeenCalledWith(expect.objectContaining({
      documentId: "document-1",
      organizationId: "11111111-1111-4111-8111-111111111111",
    }));
    expect(documentApi.upload).not.toHaveBeenCalled();
    expect(documentApi.deleteDocument).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledOnce();
    expect(documentApi.list).toHaveBeenCalledWith({
      profileId: "11111111-1111-4111-8111-111111111111",
      category: "invoice",
      limit: 100,
    });
  });

  it("waits for linked documents before allowing an invoice save", async () => {
    const user = userEvent.setup();
    const invoiceApi = {
      create: vi.fn(),
      list: vi.fn(), summary: vi.fn(), detail: vi.fn(), update: vi.fn(), recordPayment: vi.fn(), voidPayment: vi.fn(),
    };
    const documentApi = {
      upload: vi.fn(), deleteDocument: vi.fn(), list: vi.fn(() => new Promise(() => undefined)),
      searchProfiles: vi.fn().mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111", name: "Kamiah BBQ Days", city: "Kamiah", region: "ID" }]),
    };
    render(<InvoiceEditor api={invoiceApi} documentApi={documentApi} onCancel={vi.fn()} onCreated={vi.fn()} />);

    await user.upload(screen.getByLabelText("Invoice PDF"), new File(["pdf"], "invoice.pdf", { type: "application/pdf" }));
    await user.type(screen.getByLabelText("Profile"), "Kamiah");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: /Kamiah BBQ Days/ }));

    expect(screen.getByRole("button", { name: "Checking profile PDFs…" })).toBeDisabled();
    expect(documentApi.upload).not.toHaveBeenCalled();
    expect(invoiceApi.create).not.toHaveBeenCalled();
  });

  it("keeps the latest profile documents when lookups finish out of order", async () => {
    const user = userEvent.setup();
    let resolveFirst: (value: { documents: Array<{ id: string; displayName: string }> }) => void = () => undefined;
    let resolveSecond: (value: { documents: Array<{ id: string; displayName: string }> }) => void = () => undefined;
    const first = new Promise<{ documents: Array<{ id: string; displayName: string }> }>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<{ documents: Array<{ id: string; displayName: string }> }>((resolve) => { resolveSecond = resolve; });
    const documentApi = {
      upload: vi.fn(), deleteDocument: vi.fn(),
      searchProfiles: vi.fn()
        .mockResolvedValueOnce([{ id: "11111111-1111-4111-8111-111111111111", name: "Profile A", city: null, region: null }])
        .mockResolvedValueOnce([{ id: "22222222-2222-4222-8222-222222222222", name: "Profile B", city: null, region: null }]),
      list: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
    };
    const invoiceApi = { create: vi.fn(), list: vi.fn(), summary: vi.fn(), detail: vi.fn(), update: vi.fn(), recordPayment: vi.fn(), voidPayment: vi.fn() };
    render(<InvoiceEditor api={invoiceApi} documentApi={documentApi} onCancel={vi.fn()} onCreated={vi.fn()} />);

    const profileInput = screen.getByLabelText("Profile");
    await user.type(profileInput, "A");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: "Profile A" }));
    await user.clear(profileInput);
    await user.type(profileInput, "B");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: "Profile B" }));
    await act(async () => { resolveSecond({ documents: [{ id: "document-b", displayName: "Invoice B" }] }); });
    expect(await screen.findByLabelText("Existing invoice PDF")).toHaveValue("document-b");
    await act(async () => { resolveFirst({ documents: [{ id: "document-a", displayName: "Invoice A" }] }); });

    expect(screen.getByLabelText("Existing invoice PDF")).toHaveValue("document-b");
  });

  it("keeps an explicitly selected upload when the profile has an existing invoice", async () => {
    const user = userEvent.setup();
    const invoiceApi = {
      create: vi.fn().mockResolvedValue({ invoice: { id: "invoice-1" } }),
      list: vi.fn(), summary: vi.fn(), detail: vi.fn(), update: vi.fn(), recordPayment: vi.fn(), voidPayment: vi.fn(),
    };
    const documentApi = {
      upload: vi.fn().mockResolvedValue({ documentId: "uploaded-document" }), deleteDocument: vi.fn(),
      searchProfiles: vi.fn().mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111", name: "Kamiah BBQ Days", city: "Kamiah", region: "ID" }]),
      list: vi.fn().mockResolvedValue({ documents: [{ id: "existing-document", displayName: "Existing invoice" }] }),
    };
    render(<InvoiceEditor api={invoiceApi} documentApi={documentApi} onCancel={vi.fn()} onCreated={vi.fn()} />);

    await user.upload(screen.getByLabelText("Invoice PDF"), new File(["new"], "new-invoice.pdf", { type: "application/pdf" }));
    await user.type(screen.getByLabelText("Profile"), "Kamiah");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: /Kamiah BBQ Days/ }));
    expect(await screen.findByLabelText("Existing invoice PDF")).toHaveValue("");
    await user.type(screen.getByLabelText("Invoice number"), "AZ-2027-KAMIAH");
    await user.type(screen.getByLabelText("Total amount"), "7500");
    await user.click(screen.getByRole("button", { name: "Save invoice" }));

    expect(documentApi.upload).toHaveBeenCalledOnce();
    expect(invoiceApi.create).toHaveBeenCalledWith(expect.objectContaining({ documentId: "uploaded-document" }));
  });

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
      list: vi.fn().mockResolvedValue({ documents: [] }),
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
