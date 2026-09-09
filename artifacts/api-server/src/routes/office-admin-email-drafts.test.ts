import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listForOwner: vi.fn(),
  createForOwner: vi.fn(),
  updateForOwner: vi.fn(),
  listForProfile: vi.fn(),
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
    createForOwner = mocks.createForOwner;
    updateForOwner = mocks.updateForOwner;
    listForProfile = mocks.listForProfile;
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
import { requireOwnerMiddleware } from "@/lib/auth";

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


describe("Booking profile drafts", () => {
  const input = { organizationId: draftId, contactId: draftId, subject: "Hello", body: "A personal email" };
  it("creates an unsent owner draft without an Office account", async () => {
    mocks.createForOwner.mockResolvedValue({ ...input, id: draftId, state: "draft" });
    const response = await request(app()).post("/office-admin/email-drafts").send(input);
    expect(response.status).toBe(201);
    expect(mocks.createForOwner).toHaveBeenCalledWith(input);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.claimForSend).not.toHaveBeenCalled();
  });
  it("rejects client attempts to set state or recipient address", async () => {
    const response = await request(app()).post("/office-admin/email-drafts").send({ ...input, state: "sent", recipientEmail: "other@example.org" });
    expect(response.status).toBe(400);
    expect(mocks.createForOwner).not.toHaveBeenCalled();
  });
  it("lists profile drafts and saves changes without delivery", async () => {
    mocks.listForProfile.mockResolvedValue([]);
    expect((await request(app()).get(`/office-admin/profile-email-drafts/${draftId}`)).status).toBe(200);
    expect(mocks.listForProfile).toHaveBeenCalledWith(draftId);
    mocks.updateForOwner.mockResolvedValue({ id: draftId, state: "draft" });
    expect((await request(app()).patch(`/office-admin/email-drafts/${draftId}`).send({ subject: "Edited", body: "Still a draft" })).status).toBe(200);
    expect(mocks.updateForOwner).toHaveBeenCalledWith(draftId, { subject: "Edited", body: "Still a draft" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});


it("rejects unauthenticated creation at the owner gate", async () => {
  const instance = express();
  instance.use(express.json(), requireOwnerMiddleware, router);
  const response = await request(instance).post("/office-admin/email-drafts").send({});
  expect(response.status).toBe(401);
  expect(mocks.createForOwner).not.toHaveBeenCalled();
});
