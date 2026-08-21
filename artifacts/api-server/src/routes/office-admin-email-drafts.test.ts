import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listForOwner: vi.fn(),
  returnForChanges: vi.fn(),
  claimForSend: vi.fn(),
  markSent: vi.fn(),
  restoreSubmittedAfterFailure: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/office/office-email-repository", () => ({
  DrizzleOfficeEmailRepository: class {
    listForOwner = mocks.listForOwner;
    returnForChanges = mocks.returnForChanges;
    claimForSend = mocks.claimForSend;
    markSent = mocks.markSent;
    restoreSubmittedAfterFailure = mocks.restoreSubmittedAfterFailure;
  },
}));
vi.mock("@/features/office/mail-delivery", async () => {
  const actual = await vi.importActual<any>("@/features/office/mail-delivery");
  return { ...actual, createMailDeliveryFromEnv: () => ({ send: mocks.send }) };
});

import router from "./office-admin-email-drafts";

function app() { const instance = express(); instance.use(express.json()); instance.use(router); return instance; }
const draftId = "10000000-0000-4000-8000-000000000001";
const claimed = { id: draftId, recipientEmail: "fair@example.org", subject: "Hello", body: "Draft body", state: "sending" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listForOwner.mockResolvedValue([]);
  mocks.returnForChanges.mockResolvedValue({ id: draftId, state: "needs_changes" });
  mocks.claimForSend.mockResolvedValue(claimed);
  mocks.send.mockResolvedValue({ messageId: "message-1" });
  mocks.markSent.mockResolvedValue({ ...claimed, state: "sent" });
});

describe("owner office email review", () => {
  it("returns a submitted email with a required owner note", async () => {
    const response = await request(app()).post(`/office-admin/email-drafts/${draftId}/return`).send({ note: "Please make the opening more personal." });
    expect(response.status).toBe(200);
    expect(mocks.returnForChanges).toHaveBeenCalledWith(draftId, "Please make the opening more personal.");
  });

  it("claims before delivery and supports Edit & Send overrides", async () => {
    const response = await request(app()).post(`/office-admin/email-drafts/${draftId}/send`).send({ subject: "Edited subject", body: "Edited body" });
    expect(response.status).toBe(200);
    expect(mocks.claimForSend).toHaveBeenCalledWith(draftId);
    expect(mocks.send).toHaveBeenCalledWith({ to: "fair@example.org", subject: "Edited subject", body: "Edited body" });
    expect(mocks.markSent).toHaveBeenCalledWith(draftId, expect.objectContaining({ subject: "Edited subject", messageId: "message-1" }));
  });

  it("restores Submitted if delivery fails", async () => {
    mocks.send.mockRejectedValueOnce(new Error("smtp unavailable"));
    const response = await request(app()).post(`/office-admin/email-drafts/${draftId}/send`).send({});
    expect(response.status).toBe(502);
    expect(mocks.restoreSubmittedAfterFailure).toHaveBeenCalledWith(draftId, expect.stringContaining("smtp unavailable"));
    expect(mocks.markSent).not.toHaveBeenCalled();
  });
});
