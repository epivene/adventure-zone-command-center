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

describe("follow-up owner routes", () => {
  it.each([
    ["post", "/api/follow-ups"],
    ["patch", `/api/follow-ups/${followUpId}`],
    ["delete", `/api/follow-ups/${followUpId}`],
    ["post", `/api/follow-ups/${followUpId}/complete`],
  ] as const)("returns 401 for an unauthenticated %s request", async (method, path) => {
    const response = await request(testApp())[method](path);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });

  it("creates one normal follow-up linked through the Opportunity and records timeline activity", async () => {
    const opportunities = opportunityRepository();
    const activity = activityWriter();
    const response = await request(testApp(completionService(), opportunities, activity))
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ opportunityId, kind: "email", dueAt: nextDueAt });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      ok: true,
      followUp: {
        organizationId,
        bookingId: null,
        contactId: null,
        kind: "email",
        dueAt: nextDueAt,
        completedAt: null,
        outcome: null,
      },
    });
    expect(opportunities.update).toHaveBeenCalledWith(opportunityId, {
      status: "follow_up",
      nextActionKind: "email",
      nextActionDueAt: new Date(nextDueAt),
    });
    expect(activity.recordFollowUpCreated).toHaveBeenCalledWith({
      opportunityId,
      followUpId: "40000000-0000-4000-8000-000000000004",
      dueAt: new Date(nextDueAt),
    });
  });

  it("creates a follow-up directly from a profile without requiring an Opportunity", async () => {
    const response = await request(testApp())
      .post("/api/follow-ups")
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ organizationId, contactId: null, bookingId: null, kind: "email", dueAt: nextDueAt });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      ok: true,
      followUp: {
        organizationId,
        contactId: null,
        bookingId: null,
        kind: "email",
        dueAt: nextDueAt,
        completedAt: null,
      },
    });
  });

  it("returns the updated follow-up for a valid PATCH", async () => {
    const response = await request(testApp())
      .patch(`/api/follow-ups/${followUpId}`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ kind: "email", dueAt, completed: true, outcome: "Sent proposal" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      followUp: {
        id: followUpId,
        kind: "email",
        dueAt,
        completedAt: "2026-09-02T15:00:00.000Z",
        outcome: "Sent proposal",
      },
    });
  });

  it("returns 400 for an invalid PATCH", async () => {
    const response = await request(testApp())
      .patch(`/api/follow-ups/${followUpId}`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ kind: " ", dueAt, completed: false, outcome: null });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ ok: false, error: "Follow-up kind is required." });
  });

  it("returns 404 for a missing follow-up", async () => {
    const response = await request(testApp())
      .patch(`/api/follow-ups/${missingFollowUpId}`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ kind: "email", dueAt, completed: false, outcome: null });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ ok: false, error: "Follow-up not found." });
  });

  it("completes an existing work item and schedules the next action", async () => {
    const completion = completionService();
    const response = await request(testApp(completion))
      .post(`/api/follow-ups/${followUpId}/complete`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ opportunityId, outcome: "Sent first outreach", nextAction: { kind: "email", dueAt: nextDueAt } });

    expect(response.status).toBe(200);
    expect(completion.completeFollowUp).toHaveBeenCalledWith({
      opportunityId,
      followUpId,
      outcome: "Sent first outreach",
      nextAction: { kind: "email", dueAt: new Date(nextDueAt) },
    });
    expect(response.body).toMatchObject({
      ok: true,
      followUp: {
        id: followUpId,
        completedAt: "2026-09-02T15:00:00.000Z",
        outcome: "Sent first outreach",
      },
    });
  });

  it("rejects an invalid Opportunity completion payload", async () => {
    const completion = completionService();
    const response = await request(testApp(completion))
      .post(`/api/follow-ups/${followUpId}/complete`)
      .set("Authorization", `Bearer ${ownerToken()}`)
      .send({ opportunityId: "not-a-uuid", outcome: " ", nextAction: { kind: "email", dueAt: "not-a-date" } });
    expect(response.status).toBe(400);
    expect(completion.completeFollowUp).not.toHaveBeenCalled();
  });

  it("returns ok after deleting a follow-up", async () => {
    const response = await request(testApp())
      .delete(`/api/follow-ups/${followUpId}`)
      .set("Authorization", `Bearer ${ownerToken()}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
