import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createGoogleWorkspaceValidationRouter } from "./google-workspace-validation";

function appWith(options: {
  run?: (limit: number) => Promise<unknown>;
  setDecision?: (input: {
    status: "approved" | "rejected";
    actorId: string;
    now: Date;
  }) => Promise<void>;
  listReviewItems?: () => Promise<any[]>;
  resolveReviewItem?: (input: {
    messageId: string;
    organizationId: string;
    actorId: string;
    now: Date;
  }) => Promise<void>;
  ignoreReviewItem?: (input: {
    messageId: string;
    actorId: string;
    now: Date;
  }) => Promise<void>;
}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { userId?: string }).userId = "owner-1";
    next();
  });
  app.use(
    createGoogleWorkspaceValidationRouter({
      service: { run: options.run ?? (async () => ({})) },
      validationRepository: {
        setDecision: options.setDecision ?? (async () => undefined),
        getStatus: async () => "ready_for_review",
        listReviewItems: options.listReviewItems ?? (async () => []),
        resolveReviewItem: options.resolveReviewItem ?? (async () => undefined),
        ignoreReviewItem: options.ignoreReviewItem ?? (async () => undefined),
      },
      now: () => new Date("2026-08-24T17:00:00.000Z"),
    }),
  );
  return app;
}

describe("Google Workspace recent validation route", () => {
  it("runs a bounded 100-item validation sample", async () => {
    const run = vi.fn(async (limit: number) => ({
      checkedLimit: limit,
      aiEnabled: false,
      historicalImportStarted: false,
      validationStatus: "ready_for_review",
      counts: { discovered: 0, matched: 0, needsReview: 0, ignored: 0 },
      matched: [],
      needsReview: [],
      ignored: [],
    }));

    const response = await request(appWith({ run }))
      .post("/google-workspace/validation/recent")
      .send({ limit: 100 });

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(100);
    expect(response.body.aiEnabled).toBe(false);
    expect(response.body.historicalImportStarted).toBe(false);
    expect(response.body.validationStatus).toBe("ready_for_review");
  });

  it("rejects attempts to expand the validation sample beyond 100", async () => {
    const run = vi.fn(async () => ({}));
    const response = await request(appWith({ run }))
      .post("/google-workspace/validation/recent")
      .send({ limit: 101 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "GOOGLE_WORKSPACE_VALIDATION_INPUT_INVALID" });
    expect(run).not.toHaveBeenCalled();
  });

  it("lists durable Needs Review items", async () => {
    const listReviewItems = vi.fn(async () => [{
      messageId: "m1",
      threadId: "t1",
      subject: "County Fair application",
      from: "fair@example.org",
      to: "zone@example.com",
      internalDateMs: 1,
      evidenceCodes: [],
      candidates: [],
      hasAttachments: false,
      state: "pending",
      resolvedOrganizationId: null,
    }]);

    const response = await request(appWith({ listReviewItems }))
      .get("/google-workspace/validation/review");

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
  });

  it("assigns a review item to a selected live profile", async () => {
    const resolveReviewItem = vi.fn(async () => undefined);
    const response = await request(appWith({ resolveReviewItem }))
      .put("/google-workspace/validation/review/m1")
      .send({ organizationId: "11111111-1111-4111-8111-111111111111" });

    expect(response.status).toBe(200);
    expect(resolveReviewItem).toHaveBeenCalledWith({
      messageId: "m1",
      organizationId: "11111111-1111-4111-8111-111111111111",
      actorId: "owner-1",
      now: new Date("2026-08-24T17:00:00.000Z"),
    });
  });

  it("ignores a review item without assigning a profile", async () => {
    const ignoreReviewItem = vi.fn(async () => undefined);
    const response = await request(appWith({ ignoreReviewItem }))
      .post("/google-workspace/validation/review/m1/ignore")
      .send({});

    expect(response.status).toBe(200);
    expect(ignoreReviewItem).toHaveBeenCalledWith({
      messageId: "m1",
      actorId: "owner-1",
      now: new Date("2026-08-24T17:00:00.000Z"),
    });
  });

  it("records owner approval without starting historical import", async () => {
    const setDecision = vi.fn(async () => undefined);

    const response = await request(appWith({ setDecision }))
      .post("/google-workspace/validation/decision")
      .send({ decision: "approve" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      validationStatus: "approved",
      historicalImportStarted: false,
    });
    expect(setDecision).toHaveBeenCalledWith({
      status: "approved",
      actorId: "owner-1",
      now: new Date("2026-08-24T17:00:00.000Z"),
    });
  });

  it("records rejection as review state only", async () => {
    const setDecision = vi.fn(async () => undefined);

    const response = await request(appWith({ setDecision }))
      .post("/google-workspace/validation/decision")
      .send({ decision: "reject" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      validationStatus: "rejected",
      historicalImportStarted: false,
    });
    expect(setDecision).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejected" }),
    );
  });
});
