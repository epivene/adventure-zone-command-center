import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));

import { FollowUpService } from "@/features/follow-ups/follow-up-service";
import type { FollowUpRepository } from "@/features/follow-ups/follow-up-repository";
import type {
  CreateFollowUpInput,
  EditFollowUpInput,
  FollowUpRecord,
} from "@/features/follow-ups/follow-up-types";
import type { OpportunityRecord, UpdateOpportunityInput } from "@/features/opportunities/opportunity-types";
import { issueToken, requireOwnerMiddleware } from "@/lib/auth";
import { createFollowUpsRouter } from "./follow-ups";

const followUpId = "40000000-0000-4000-8000-000000000001";
const missingFollowUpId = "40000000-0000-4000-8000-000000000002";
const opportunityId = "50000000-0000-4000-8000-000000000001";
const organizationId = "10000000-0000-4000-8000-000000000001";
const dueAt = "2026-09-01T15:00:00.000Z";
const nextDueAt = "2026-09-08T15:00:00.000Z";

class MemoryFollowUpRepository implements FollowUpRepository {
  private followUp: FollowUpRecord | null = {
    id: followUpId,
    organizationId,
    contactId: null,
    bookingId: null,
    kind: "call",
    dueAt: new Date(dueAt),
    completedAt: null,
    outcome: null,
  };

  async create(input: CreateFollowUpInput) {
    this.followUp = {
      id: "40000000-0000-4000-8000-000000000004",
      organizationId: input.organizationId,
      contactId: input.contactId,
      bookingId: input.bookingId,
      kind: input.kind,
      dueAt: input.dueAt,
      completedAt: null,
      outcome: null,
    };
    return { ok: true as const, value: this.followUp };
  }

  async edit(input: EditFollowUpInput) {
    if (!this.followUp || input.followUpId !== this.followUp.id) {
      return { ok: false as const, error: { code: "FOLLOW_UP_NOT_FOUND" as const } };
    }
    this.followUp = {
      ...this.followUp,
      kind: input.kind,
      dueAt: input.dueAt,
      completedAt: input.completed ? new Date("2026-09-02T15:00:00.000Z") : null,
      outcome: input.outcome,
    };
    return { ok: true as const, value: this.followUp };
  }

  async delete(id: string) {
    if (!this.followUp || id !== this.followUp.id) {
      return { ok: false as const, error: { code: "FOLLOW_UP_NOT_FOUND" as const } };
    }
    this.followUp = null;
    return { ok: true as const, value: undefined };
  }
}

const opportunity: OpportunityRecord = {
  id: opportunityId,
  organizationId,
  eventYear: 2026,
  bookingId: null,
  contactId: null,
  status: "contacted",
  priority: "normal",
  nextActionKind: null,
  nextActionDueAt: null,
  holdReason: null,
  emailAutomationProtected: false,
  territoryExceptionApproved: false,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

function opportunityRepository() {
  return {
    get: vi.fn(async (id: string) => id === opportunityId ? opportunity : null),
    update: vi.fn(async (_id: string, patch: UpdateOpportunityInput) => ({ ...opportunity, ...patch })),
  };
}

function activityWriter() {
  return {
    recordFollowUpCreated: vi.fn(async () => undefined),
  };
}

function ownerToken(): string {
  const issued = issueToken();
  if (!issued) throw new Error("test owner token was not issued");
  return issued.token;
}

function completionService() {
  return {
    completeFollowUp: vi.fn(async (input: {
      opportunityId: string;
      followUpId: string;
      outcome: string;
      nextAction: { kind: string; dueAt: Date } | null;
    }) => ({
      ok: true as const,
      value: {
        id: input.followUpId,
        bookingId: null,
        kind: "email",
        dueAt: new Date(dueAt),
        completedAt: new Date("2026-09-02T15:00:00.000Z"),
        outcome: input.outcome,
        nextFollowUpId: "40000000-0000-4000-8000-000000000003",
      },
    })),
  };
}

function testApp(
  completion = completionService(),
  opportunities = opportunityRepository(),
  activity = activityWriter(),
) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/follow-ups",
    requireOwnerMiddleware,
    createFollowUpsRouter(
      new FollowUpService(new MemoryFollowUpRepository()),
      completion,
      opportunities,
      activity,
    ),
  );
  return app;
}

beforeEach(() => {
  process.env.SESSION_SECRET = "follow-up-route-test-secret";
});

describe("follow-up routes", () => {
  it("requires owner auth", async () => {
    const response = await request(testApp()).get(`/api/follow-ups/${followUpId}`);
    expect(response.status).toBe(401);
  });

  it("gets a follow-up", async () => {
    const response = await request(testApp())
      .get(`/api/follow-ups/${followUpId}`)
      .set("Authorization", `Bearer ${ownerToken()}`);
    expect(response.status).toBe(200);
    expect(response.body.followUp.id).toBe(followUpId);
  });

  it("creates a normal follow-up linked through the Opportunity", async () => {
    const opportunities = opportunityRepository();
    const activity = activityWriter();
    const response = await request(testApp(completionService(), opportunities, activity))
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        opportunityId,
        kind: "email",
        dueAt: nextDueAt,
      });

    expect(response.status).toBe(201);
    expect(response.body.followUp).toMatchObject({
      organizationId,
      kind: "email",
      dueAt: nextDueAt,
    });
    expect(opportunities.update).toHaveBeenCalledWith(opportunityId, {
      status: "follow_up",
      nextActionKind: "follow_up",
      nextActionDueAt: new Date(nextDueAt),
    });
    expect(activity.recordFollowUpCreated).toHaveBeenCalledWith(expect.objectContaining({
      opportunityId,
      dueAt: new Date(nextDueAt),
    }));
  });

  it("returns 404 when the Opportunity does not exist", async () => {
    const opportunities = opportunityRepository();
    opportunities.get.mockResolvedValue(null);
    const response = await request(testApp(completionService(), opportunities))
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ opportunityId, kind: "email", dueAt: nextDueAt });
    expect(response.status).toBe(404);
  });

  it("rejects malformed follow-up creation", async () => {
    const response = await request(testApp())
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ opportunityId: "bad", kind: "invalid", dueAt: "yesterday" });
    expect(response.status).toBe(400);
  });

  it("edits a follow-up", async () => {
    const response = await request(testApp())
      .patch(`/api/follow-ups/${followUpId}`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ kind: "email", dueAt: nextDueAt, completed: false, outcome: null });
    expect(response.status).toBe(200);
    expect(response.body.followUp.kind).toBe("email");
  });

  it("completes a follow-up with optional next action", async () => {
    const completion = completionService();
    const response = await request(testApp(completion))
      .post(`/api/follow-ups/${followUpId}/complete`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({
        opportunityId,
        outcome: "Spoke with organizer",
        nextAction: { kind: "call", dueAt: nextDueAt },
      });
    expect(response.status).toBe(200);
    expect(completion.completeFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      opportunityId,
      followUpId,
      outcome: "Spoke with organizer",
    }));
  });

  it("deletes a follow-up", async () => {
    const response = await request(testApp())
      .delete(`/api/follow-ups/${followUpId}`)
      .set("Authorization", `Bearer ${ownerToken()}`);
    expect(response.status).toBe(204);
  });

  it("returns 404 for a missing follow-up", async () => {
    const response = await request(testApp())
      .get(`/api/follow-ups/${missingFollowUpId}`)
      .set("Authorization", `Bearer ${ownerToken()}`);
    expect(response.status).toBe(404);
  });

  it("rejects malformed edit input", async () => {
    const response = await request(testApp())
      .patch(`/api/follow-ups/${followUpId}`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ kind: "invalid", dueAt: "not-a-date", completed: "nope" });
    expect(response.status).toBe(400);
  });

  it("rejects malformed complete input", async () => {
    const response = await request(testApp())
      .post(`/api/follow-ups/${followUpId}/complete`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ opportunityId: "bad", outcome: 123 });
    expect(response.status).toBe(400);
  });
});
