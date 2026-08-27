import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createOpportunityEmailRuntimeRouter } from "./opportunity-email-runtime";

const opportunityId = "10000000-0000-4000-8000-000000000001";
const draftId = "30000000-0000-4000-8000-000000000001";

function draftRecord() {
  const now = new Date("2026-08-27T18:00:00.000Z");
  return {
    id: draftId,
    opportunityId,
    organizationId: "20000000-0000-4000-8000-000000000001",
    contactId: null,
    eventYear: 2026,
    purpose: "new_outreach" as const,
    state: "draft" as const,
    gmailDraftId: "gmail-draft-1",
    gmailMessageId: "gmail-message-1",
    gmailThreadId: null,
    recipientEmail: "fair@example.com",
    recipientName: "Casey",
    subject: "Adventure Zone for Sample Fair",
    body: "Draft body",
    scheduledFor: null,
    sentAt: null,
    lastFailureCode: null,
    lastFailureMessage: null,
    sendRequestKey: null,
    scheduleRequestKey: null,
    createdAt: now,
    updatedAt: now,
  };
}

function services() {
  const draft = draftRecord();
  return {
    drafts: {
      createDraft: vi.fn(async () => ({ ok: true as const, draft })),
      getDraft: vi.fn(async () => draft),
      saveDraft: vi.fn(async () => draft),
      rewriteDraft: vi.fn(async () => ({ draft, undoSubject: draft.subject, undoBody: draft.body })),
      sendDraft: vi.fn(async () => ({ draft: { ...draft, state: "sent" as const }, followUpReferenceAt: new Date("2026-08-27T18:30:00.000Z") })),
      scheduleDraft: vi.fn(async () => ({ draft: { ...draft, state: "scheduled" as const }, followUpReferenceAt: new Date("2026-08-28T14:00:00.000Z") })),
      retryDraft: vi.fn(async () => ({ draft, followUpReferenceAt: null })),
    },
    readyToSend: {
      summary: vi.fn(async () => ({ total: 1, newOutreach: 1, followUps: 0, replies: 0, items: [] })),
      sendSelected: vi.fn(async () => [{ draftId, ok: true }]),
      scheduleSelected: vi.fn(async () => [{ draftId, ok: true }]),
    },
  };
}

function appWith(runtime: ReturnType<typeof services>) {
  const app = express();
  app.use(express.json());
  app.use("/api", createOpportunityEmailRuntimeRouter(runtime));
  return app;
}

describe("Release 2 runtime router", () => {
  it("mounts Opportunity draft creation at the production API path", async () => {
    const runtime = services();
    const response = await request(appWith(runtime))
      .post(`/api/opportunities/${opportunityId}/drafts`)
      .send({ purpose: "new_outreach" });

    expect(response.status).toBe(201);
    expect(runtime.drafts.createDraft).toHaveBeenCalledWith({ opportunityId, purpose: "new_outreach" });
  });

  it("mounts Today Ready to Send at the production API path", async () => {
    const runtime = services();
    const response = await request(appWith(runtime)).get("/api/today/ready-to-send");

    expect(response.status).toBe(200);
    expect(runtime.readyToSend.summary).toHaveBeenCalledTimes(1);
  });
});
