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