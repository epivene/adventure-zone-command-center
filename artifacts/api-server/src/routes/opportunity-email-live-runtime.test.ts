import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createLazyOpportunityEmailRuntimeRouter } from "./opportunity-email-live-runtime";

const opportunityId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";

function draft() {
  const now = new Date("2026-08-28T15:00:00.000Z");
  return {
    id: draftId,
    opportunityId,
    organizationId: "33333333-3333-4333-8333-333333333333",
    contactId: null,
    eventYear: 2026,
    purpose: "new_outreach" as const,
    state: "draft" as const,
    gmailDraftId: "gmail-draft-1",
    gmailMessageId: "gmail-message-1",
    gmailThreadId: null,
    recipientEmail: "booking@example.com",
    recipientName: "Casey",
    subject: "Hello",
    body: "Body",
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

function runtime() {
  return {
    drafts: {
      createDraft: vi.fn(async () => ({ ok: true as const, draft: draft() })),
      getDraft: vi.fn(async () => draft()),
      saveDraft: vi.fn(),
      rewriteDraft: vi.fn(),
      sendDraft: vi.fn(),
      scheduleDraft: vi.fn(),
      retryDraft: vi.fn(),
    },
    readyToSend: {
      summary: vi.fn(async () => ({ total: 0, newOutreach: 0, followUps: 0, replies: 0, items: [] })),
      sendSelected: vi.fn(),
      scheduleSelected: vi.fn(),
    },
  };
}

describe("createLazyOpportunityEmailRuntimeRouter", () => {
  it("loads one shared production runtime lazily for draft and Outbox routes", async () => {
    const shared = runtime();
    const loadRuntime = vi.fn(async () => shared);
    const app = express();
    app.use(express.json());
    app.use("/api", createLazyOpportunityEmailRuntimeRouter(loadRuntime as any));

    await request(app)
      .post(`/api/opportunities/${opportunityId}/drafts`)
      .send({ purpose: "new_outreach" })
      .expect(201);
    await request(app)
      .get("/api/today/ready-to-send")
      .expect(200, {
        ok: true,
        summary: { total: 0, newOutreach: 0, followUps: 0, replies: 0, items: [] },
      });

    expect(loadRuntime).toHaveBeenCalledTimes(1);
  });

  it("keeps the API alive when the email runtime cannot initialize", async () => {
    const app = express();
    app.use("/api", createLazyOpportunityEmailRuntimeRouter(async () => {
      throw Object.assign(new Error("NO_AI_PROVIDER_CONFIGURED"), { code: "NO_AI_PROVIDER_CONFIGURED" });
    }));

    await request(app)
      .get("/api/today/ready-to-send")
      .expect(503, { error: "OPPORTUNITY_EMAIL_RUNTIME_UNAVAILABLE" });
  });
});
