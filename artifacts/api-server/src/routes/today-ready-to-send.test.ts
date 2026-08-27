import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { issueToken, requireOwnerMiddleware } from "@/lib/auth";
import { createTodayReadyToSendRouter } from "./today-ready-to-send";

const DRAFT_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_DRAFT_ID = "10000000-0000-4000-8000-000000000002";
const OPPORTUNITY_ID = "20000000-0000-4000-8000-000000000001";
const SECOND_OPPORTUNITY_ID = "20000000-0000-4000-8000-000000000002";
const FUTURE = "2026-08-28T14:00:00.000Z";

function ownerToken(): string {
  const token = issueToken();
  if (!token) throw new Error("owner token missing");
  return token.token;
}

function service(overrides: Record<string, unknown> = {}) {
  return {
    summary: vi.fn(async () => ({ total: 2, newOutreach: 1, followUps: 1, replies: 0, items: [] })),
    sendSelected: vi.fn(async () => [{ draftId: DRAFT_ID, ok: true }]),
    scheduleSelected: vi.fn(async () => [{ draftId: DRAFT_ID, ok: true }]),
    ...overrides,
  };
}

function app(svc = service()) {
  const app = express();
  app.use(express.json());
  app.use("/api/today/ready-to-send", requireOwnerMiddleware, createTodayReadyToSendRouter(svc as any, {
    now: () => new Date("2026-08-27T18:00:00.000Z"),
  }));
  return { app, svc };
}

beforeEach(() => {
  process.env.SESSION_SECRET = "ready-to-send-route-secret";
});

describe("Today Ready to Send routes", () => {
  it("requires owner authentication", async () => {
    const { app: testApp } = app();
    const response = await request(testApp).get("/api/today/ready-to-send");
    expect(response.status).toBe(401);
  });

  it("returns the Outbox summary", async () => {
    const { app: testApp } = app();
    const response = await request(testApp)
      .get("/api/today/ready-to-send")
      .set("Authorization", `Bearer ${ownerToken()}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, summary: { total: 2, newOutreach: 1, followUps: 1 } });
  });

  it("bulk sends only the validated selected rows", async () => {
    const { app: testApp, svc } = app();
    const items = [
      { draftId: DRAFT_ID, opportunityId: OPPORTUNITY_ID, requestKey: "send-1" },
      { draftId: SECOND_DRAFT_ID, opportunityId: SECOND_OPPORTUNITY_ID, requestKey: "send-2" },
    ];
    const response = await request(testApp)
      .post("/api/today/ready-to-send/send")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ items });
    expect(response.status).toBe(200);
    expect(svc.sendSelected).toHaveBeenCalledWith(items);
  });

  it("bulk schedules explicit future timestamps", async () => {
    const { app: testApp, svc } = app();
    const response = await request(testApp)
      .post("/api/today/ready-to-send/schedule")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ items: [{ draftId: DRAFT_ID, opportunityId: OPPORTUNITY_ID, requestKey: "schedule-1", scheduledFor: FUTURE }] });
    expect(response.status).toBe(200);
    expect(svc.scheduleSelected).toHaveBeenCalledWith([{
      draftId: DRAFT_ID,
      opportunityId: OPPORTUNITY_ID,
      requestKey: "schedule-1",
      scheduledFor: new Date(FUTURE),
    }]);
  });

  it.each([
    ["/api/today/ready-to-send/send", { items: [] }],
    ["/api/today/ready-to-send/send", { items: [{ draftId: "bad", opportunityId: OPPORTUNITY_ID, requestKey: "x" }] }],
    ["/api/today/ready-to-send/schedule", { items: [{ draftId: DRAFT_ID, opportunityId: OPPORTUNITY_ID, requestKey: "x", scheduledFor: "2026-08-27T17:59:00.000Z" }] }],
  ])("rejects invalid bulk payloads for %s", async (path, body) => {
    const { app: testApp } = app();
    const response = await request(testApp)
      .post(path)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);
    expect(response.status).toBe(400);
  });

  it("maps all-selection prevalidation failure to conflict instead of starting work", async () => {
    const { app: testApp } = app(service({
      sendSelected: vi.fn(async () => { throw Object.assign(new Error("READY_TO_SEND_SELECTION_INVALID"), { code: "READY_TO_SEND_SELECTION_INVALID" }); }),
    }));
    const response = await request(testApp)
      .post("/api/today/ready-to-send/send")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ items: [{ draftId: DRAFT_ID, opportunityId: OPPORTUNITY_ID, requestKey: "send-1" }] });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ ok: false, error: "READY_TO_SEND_SELECTION_INVALID" });
  });
});
