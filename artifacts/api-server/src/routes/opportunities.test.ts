import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));

import { issueToken, requireOwnerMiddleware } from "@/lib/auth";
import type { OpportunityRecord } from "@/features/opportunities/opportunity-types";
import { createOpportunitiesRouter } from "./opportunities";

const ID = "10000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const record: OpportunityRecord = {
  id: ID,
  organizationId: ORGANIZATION_ID,
  eventYear: 2026,
  bookingId: null,
  contactId: null,
  status: "follow_up",
  priority: "normal",
  nextActionKind: "email",
  nextActionDueAt: new Date("2026-09-01T15:00:00.000Z"),
  holdReason: null,
  emailAutomationProtected: false,
  territoryExceptionApproved: false,
  createdAt: new Date("2026-08-26T15:00:00.000Z"),
  updatedAt: new Date("2026-08-26T15:00:00.000Z"),
};

function ownerToken() {
  const token = issueToken();
  if (!token) throw new Error("owner token missing");
  return token.token;
}

function repository() {
  let current = { ...record };
  return {
    get: vi.fn(async (id: string) => (id === ID ? current : null)),
    getForOrganizationYear: vi.fn(async (organizationId: string, year: number) =>
      organizationId === ORGANIZATION_ID && year === 2026 ? current : null,
    ),
    update: vi.fn(async (_id: string, patch: Partial<OpportunityRecord>) => {
      current = { ...current, ...patch, updatedAt: new Date() };
      return current;
    }),
  };
}

function app(repo = repository(), promotion = { confirmInterest: vi.fn(async () => null) }) {
  const app = express();
  app.use(express.json());
  app.use("/api/opportunities", requireOwnerMiddleware, createOpportunitiesRouter(repo, {
    promotion,
    now: () => new Date("2026-09-09T15:00:00Z"),
  }));
  return { app, repo, promotion };
}

beforeEach(() => {
  process.env.SESSION_SECRET = "opportunity-route-test-secret";
});

describe("Opportunity routes", () => {
  it("reads the current organization/year Opportunity", async () => {
    const { app: testApp } = app();
    const response = await request(testApp)
      .get(`/api/opportunities/current?organizationId=${ORGANIZATION_ID}&year=2026`)
      .set("Authorization", `Bearer ${ownerToken()}`);
    expect(response.status).toBe(200);
    expect(response.body.opportunity).toMatchObject({ id: ID, eventYear: 2026 });
  });

  it("validates organization and year", async () => {
    const { app: testApp } = app();
    const response = await request(testApp)
      .get("/api/opportunities/current?organizationId=bad&year=26")
      .set("Authorization", `Bearer ${ownerToken()}`);
    expect(response.status).toBe(400);
  });

  it("updates authoritative priority and next action", async () => {
    const { app: testApp, repo, promotion } = app();
    const response = await request(testApp)
      .patch(`/api/opportunities/${ID}`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ priority: "high", nextActionKind: "call" });
    expect(response.status).toBe(200);
    expect(repo.update).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ priority: "high", nextActionKind: "call" }),
    );
  });

  it("suggests subjective interest without applying it", async () => {
    const { app: testApp, repo, promotion } = app();
    const response = await request(testApp)
      .patch(`/api/opportunities/${ID}`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ status: "interested" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ suggestedStatus: "interested" });
    expect(repo.update).not.toHaveBeenCalled();
    expect(promotion.confirmInterest).not.toHaveBeenCalled();
  });

  it("applies a suggested subjective status only through explicit approval", async () => {
    const { app: testApp, repo, promotion } = app();
    const response = await request(testApp)
      .post(`/api/opportunities/${ID}/apply-suggested-status`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ status: "interested" });
    expect(response.status).toBe(200);
    expect(repo.update).toHaveBeenCalledWith(ID, { status: "interested" });
    expect(promotion.confirmInterest).toHaveBeenCalledWith({
      opportunityId: ID,
      confirmedAt: new Date("2026-09-09T15:00:00Z"),
      evidenceMessageId: null,
    });
  });

  it("rejects invalid status and priority values", async () => {
    const { app: testApp } = app();
    const response = await request(testApp)
      .patch(`/api/opportunities/${ID}`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ status: "maybe", priority: "critical" });
    expect(response.status).toBe(400);
  });
});


