import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));

import { issueToken, requireOwnerMiddleware } from "@/lib/auth";
import type { OpportunityEmailRecord } from "@/features/opportunity-email/opportunity-email-types";
import { createOpportunityDraftsRouter } from "./opportunity-drafts";

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-27T18:00:00.000Z");

function draft(overrides: Partial<OpportunityEmailRecord> = {}): OpportunityEmailRecord {
  return {
    id: DRAFT_ID,
    opportunityId: OPPORTUNITY_ID,
    organizationId: "22222222-2222-4222-8222-222222222222",
    contactId: "44444444-4444-4444-8444-444444444444",
    eventYear: 2026,
    purpose: "new_outreach",
    state: "draft",
    gmailDraftId: "gmail-draft-1",
    gmailMessageId: "gmail-message-1",
    gmailThreadId: null,
    recipientEmail: "booking@example.com",
    recipientName: "Casey Organizer",
    subject: "Subject",
    body: "Body",
    scheduledFor: null,
    sentAt: null,
    lastFailureCode: null,
    lastFailureMessage: null,
    sendRequestKey: null,
    scheduleRequestKey: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function service() {
  return {
    createDraft: vi.fn(async () => ({ ok: true as const, draft: draft() })),
    getDraft: vi.fn(async () => draft()),
    saveDraft: vi.fn(async () => draft({ subject: "Edited", body: "Edited body" })),
    rewriteDraft: vi.fn(async () => ({
      draft: draft({ body: "Shorter body" }),
      undoSubject: "Subject",
      undoBody: "Body",
    })),
    sendDraft: vi.fn(async () => ({ draft: draft({ state: "sent", sentAt: NOW }), followUpReferenceAt: NOW })),
    scheduleDraft: vi.fn(async ({ scheduledFor }: { scheduledFor: Date }) => ({
      draft: draft({ state: "scheduled", scheduledFor }),
      followUpReferenceAt: scheduledFor,
    })),
    retryDraft: vi.fn(async () => ({ draft: draft(), followUpReferenceAt: null })),
  };
}

function ownerToken() {
  const token = issueToken();
  if (!token) throw new Error("owner token missing");
  return token.token;
}

function app(routeService = service()) {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(
    "/api/opportunities",
    requireOwnerMiddleware,
    createOpportunityDraftsRouter(routeService, { now: () => NOW }),
  );
  return { app: testApp, service: routeService };
}

beforeEach(() => {
  process.env.SESSION_SECRET = "opportunity-drafts-route-test-secret";
});

describe("Opportunity draft routes", () => {
  it("requires owner authentication", async () => {
    const { app: testApp } = app();
    const response = await request(testApp)
      .post(`/api/opportunities/${OPPORTUNITY_ID}/drafts`)
      .send({ purpose: "new_outreach" });
    expect(response.status).toBe(401);
  });

  it("creates a draft only through the explicit create route", async () => {
    const { app: testApp, service: mockService } = app();
    const response = await request(testApp)
      .post(`/api/opportunities/${OPPORTUNITY_ID}/drafts`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ purpose: "new_outreach" });

    expect(response.status).toBe(201);
    expect(mockService.createDraft).toHaveBeenCalledWith({
      opportunityId: OPPORTUNITY_ID,
      purpose: "new_outreach",
    });
    expect(response.body.draft.id).toBe(DRAFT_ID);
  });

  it("returns workflow blockers as 409 rather than generic errors", async () => {
    const mockService = service();
    mockService.createDraft.mockResolvedValueOnce({
      ok: false as const,
      blocker: {
        code: "ambiguous_recipient",
        message: "Choose the correct contact.",
        requiresHumanReview: true as const,
      },
    } as never);
    const { app: testApp } = app(mockService);
    const response = await request(testApp)
      .post(`/api/opportunities/${OPPORTUNITY_ID}/drafts`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ purpose: "new_outreach" });

    expect(response.status).toBe(409);
    expect(response.body.blocker.code).toBe("ambiguous_recipient");
  });

  it("gets and saves the current opportunity draft", async () => {
    const { app: testApp, service: mockService } = app();
    const getResponse = await request(testApp)
      .get(`/api/opportunities/${OPPORTUNITY_ID}/draft`)
      .set("Authorization", `Bearer ${ownerToken()}`);
    expect(getResponse.status).toBe(200);
    expect(mockService.getDraft).toHaveBeenCalledWith(OPPORTUNITY_ID);

    const patchResponse = await request(testApp)
      .patch(`/api/opportunities/${OPPORTUNITY_ID}/draft`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ draftId: DRAFT_ID, subject: "Edited", body: "Edited body" });
    expect(patchResponse.status).toBe(200);
    expect(mockService.saveDraft).toHaveBeenCalledWith({
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
      subject: "Edited",
      body: "Edited body",
    });
  });

  it("validates the seven rewrite actions and delegates current content", async () => {
    const { app: testApp, service: mockService } = app();
    const bad = await request(testApp)
      .post(`/api/opportunities/${OPPORTUNITY_ID}/draft/rewrite`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ draftId: DRAFT_ID, action: "make_magical", subject: "Subject", body: "Body" });
    expect(bad.status).toBe(400);

    const response = await request(testApp)
      .post(`/api/opportunities/${OPPORTUNITY_ID}/draft/rewrite`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ draftId: DRAFT_ID, action: "shorter", subject: "Subject", body: "Body" });
    expect(response.status).toBe(200);
    expect(mockService.rewriteDraft).toHaveBeenCalledWith({
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
      action: "shorter",
      subject: "Subject",
      body: "Body",
    });
  });

  it("delegates send, schedule, and retry with strict request keys and future schedule validation", async () => {
    const { app: testApp, service: mockService } = app();
    const send = await request(testApp)
      .post(`/api/opportunities/${OPPORTUNITY_ID}/draft/send`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ draftId: DRAFT_ID, requestKey: "send-request-1" });
    expect(send.status).toBe(200);
    expect(mockService.sendDraft).toHaveBeenCalledWith({
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
      requestKey: "send-request-1",
    });

    const past = await request(testApp)
      .post(`/api/opportunities/${OPPORTUNITY_ID}/draft/schedule`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ draftId: DRAFT_ID, requestKey: "schedule-past", scheduledFor: "2026-08-27T17:00:00.000Z" });
    expect(past.status).toBe(400);

    const scheduledFor = "2026-08-28T15:00:00.000Z";
    const scheduled = await request(testApp)
      .post(`/api/opportunities/${OPPORTUNITY_ID}/draft/schedule`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ draftId: DRAFT_ID, requestKey: "schedule-request-1", scheduledFor });
    expect(scheduled.status).toBe(200);
    expect(mockService.scheduleDraft).toHaveBeenCalledWith({
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
      requestKey: "schedule-request-1",
      scheduledFor: new Date(scheduledFor),
    });

    const retry = await request(testApp)
      .post(`/api/opportunities/${OPPORTUNITY_ID}/draft/retry`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ draftId: DRAFT_ID, requestKey: "retry-request-1" });
    expect(retry.status).toBe(200);
    expect(mockService.retryDraft).toHaveBeenCalledWith({
      opportunityId: OPPORTUNITY_ID,
      draftId: DRAFT_ID,
      requestKey: "retry-request-1",
    });
  });

  it("rejects malformed opportunity/draft IDs, empty content, and invalid purpose", async () => {
    const { app: testApp } = app();
    const token = `Bearer ${ownerToken()}`;

    expect((await request(testApp).post("/api/opportunities/not-a-uuid/drafts").set("Authorization", token).send({ purpose: "new_outreach" })).status).toBe(400);
    expect((await request(testApp).post(`/api/opportunities/${OPPORTUNITY_ID}/drafts`).set("Authorization", token).send({ purpose: "marketing_blast" })).status).toBe(400);
    expect((await request(testApp).patch(`/api/opportunities/${OPPORTUNITY_ID}/draft`).set("Authorization", token).send({ draftId: "bad", subject: "", body: "" })).status).toBe(400);
  });

  it("maps known missing draft errors to 404", async () => {
    const mockService = service();
    mockService.getDraft.mockRejectedValueOnce(Object.assign(new Error("OPPORTUNITY_EMAIL_DRAFT_NOT_FOUND"), { code: "OPPORTUNITY_EMAIL_DRAFT_NOT_FOUND" }));
    const { app: testApp } = app(mockService);
    const response = await request(testApp)
      .get(`/api/opportunities/${OPPORTUNITY_ID}/draft`)
      .set("Authorization", `Bearer ${ownerToken()}`);
    expect(response.status).toBe(404);
  });
});
