import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));

import { issueToken, requireOwnerMiddleware } from "@/lib/auth";
import { createTodayWorkRouter } from "./today";

const OPPORTUNITY_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_ID = "10000000-0000-4000-8000-000000000002";
const BUSINESS_DATE = "2026-08-26";
const SNOOZE_UNTIL = "2026-08-27T15:00:00.000Z";

function ownerToken(): string {
  const issued = issueToken();
  if (!issued) throw new Error("test owner token was not issued");
  return issued.token;
}

function controls(overrides: Record<string, unknown> = {}) {
  return {
    pin: vi.fn(async () => true),
    urgent: vi.fn(async () => true),
    snooze: vi.fn(async () => true),
    reorder: vi.fn(async () => true),
    resetOrder: vi.fn(async () => undefined),
    ...overrides,
  };
}

function testApp(service = controls()) {
  const app = express();
  app.use(express.json());
  app.use("/api", requireOwnerMiddleware, createTodayWorkRouter(service));
  return { app, service };
}

beforeEach(() => {
  process.env.SESSION_SECRET = "today-master-queue-route-secret";
});

describe("Today master queue controls", () => {
  it("requires owner authentication", async () => {
    const { app } = testApp();
    const response = await request(app)
      .post(`/api/today/work/${OPPORTUNITY_ID}/pin`)
      .send({ businessDate: BUSINESS_DATE, pinned: true });

    expect(response.status).toBe(401);
  });

  it("pins visible Opportunity work for a business date", async () => {
    const { app, service } = testApp();
    const response = await request(app)
      .post(`/api/today/work/${OPPORTUNITY_ID}/pin`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ businessDate: BUSINESS_DATE, pinned: true });

    expect(response.status).toBe(200);
    expect(service.pin).toHaveBeenCalledWith(
      OPPORTUNITY_ID,
      BUSINESS_DATE,
      true,
    );
  });

  it("sets or clears urgent priority", async () => {
    const { app, service } = testApp();
    const response = await request(app)
      .post(`/api/today/work/${OPPORTUNITY_ID}/urgent`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ urgent: true });

    expect(response.status).toBe(200);
    expect(service.urgent).toHaveBeenCalledWith(OPPORTUNITY_ID, true);
  });

  it("snoozes visible work until a future instant", async () => {
    const { app, service } = testApp();
    const response = await request(app)
      .post(`/api/today/work/${OPPORTUNITY_ID}/snooze`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ businessDate: BUSINESS_DATE, until: SNOOZE_UNTIL });

    expect(response.status).toBe(200);
    expect(service.snooze).toHaveBeenCalledWith(
      OPPORTUNITY_ID,
      BUSINESS_DATE,
      new Date(SNOOZE_UNTIL),
    );
  });

  it("reorders only user-visible Opportunity work", async () => {
    const { app, service } = testApp();
    const response = await request(app)
      .post("/api/today/work/reorder")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        businessDate: BUSINESS_DATE,
        opportunityIds: [SECOND_ID, OPPORTUNITY_ID],
      });

    expect(response.status).toBe(200);
    expect(service.reorder).toHaveBeenCalledWith(
      [SECOND_ID, OPPORTUNITY_ID],
      BUSINESS_DATE,
    );
  });

  it("resets manual order back to smart order", async () => {
    const { app, service } = testApp();
    const response = await request(app)
      .post("/api/today/work/reset-order")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ businessDate: BUSINESS_DATE });

    expect(response.status).toBe(200);
    expect(service.resetOrder).toHaveBeenCalledWith(BUSINESS_DATE);
  });

  it.each([
    [
      `/api/today/work/not-a-uuid/pin`,
      { businessDate: BUSINESS_DATE, pinned: true },
    ],
    [
      `/api/today/work/${OPPORTUNITY_ID}/pin`,
      { businessDate: "08/26/2026", pinned: true },
    ],
    [
      `/api/today/work/${OPPORTUNITY_ID}/snooze`,
      { businessDate: BUSINESS_DATE, until: "not-a-date" },
    ],
    [
      "/api/today/work/reorder",
      { businessDate: BUSINESS_DATE, opportunityIds: [OPPORTUNITY_ID, OPPORTUNITY_ID] },
    ],
  ])("rejects invalid control payloads for %s", async (path, body) => {
    const { app } = testApp();
    const response = await request(app)
      .post(path)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send(body);

    expect(response.status).toBe(400);
  });

  it("rejects reordering IDs outside the visible Booking queue", async () => {
    const { app } = testApp({ reorder: vi.fn(async () => false) });
    const response = await request(app)
      .post("/api/today/work/reorder")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        businessDate: BUSINESS_DATE,
        opportunityIds: [OPPORTUNITY_ID, SECOND_ID],
      });

    expect(response.status).toBe(409);
  });
});
