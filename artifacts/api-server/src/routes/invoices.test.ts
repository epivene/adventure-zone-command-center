import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createInvoicesRouter } from "./invoices";

const invoiceId = "11111111-1111-4111-8111-111111111111";
const paymentId = "22222222-2222-4222-8222-222222222222";

function app(service: Record<string, ReturnType<typeof vi.fn>>) {
  const server = express();
  server.use(express.json());
  server.use(createInvoicesRouter(service as never));
  return server;
}

describe("invoice routes", () => {
  it("creates an invoice from a linked uploaded document", async () => {
    const invoice = { id: invoiceId, invoiceNumber: "AZ-2027-001" };
    const service = {
      create: vi.fn().mockResolvedValue(invoice),
      list: vi.fn(), detail: vi.fn(), update: vi.fn(), recordPayment: vi.fn(), voidPayment: vi.fn(), summary: vi.fn(),
    };
    const response = await request(app(service)).post("/invoices").send({
      organizationId: "33333333-3333-4333-8333-333333333333",
      documentId: "44444444-4444-4444-8444-444444444444",
      invoiceNumber: "AZ-2027-001",
      status: "sent",
      totalCents: 750000,
      depositCents: 300000,
      issueDate: "2026-09-15",
    }).expect(201);
    expect(response.body.invoice).toEqual(invoice);
  });

  it("records and voids a payment", async () => {
    const service = {
      recordPayment: vi.fn().mockResolvedValue({ id: invoiceId }),
      voidPayment: vi.fn().mockResolvedValue({ id: invoiceId }),
      create: vi.fn(), list: vi.fn(), detail: vi.fn(), update: vi.fn(), summary: vi.fn(),
    };
    await request(app(service)).post(`/invoices/${invoiceId}/payments`)
      .send({ amountCents: 300000, receivedDate: "2026-10-15", method: "check" })
      .expect(201);
    await request(app(service)).post(`/invoices/${invoiceId}/payments/${paymentId}/void`).expect(200);
    expect(service.recordPayment).toHaveBeenCalled();
    expect(service.voidPayment).toHaveBeenCalled();
  });
});
