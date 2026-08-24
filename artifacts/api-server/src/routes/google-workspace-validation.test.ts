import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createGoogleWorkspaceValidationRouter } from "./google-workspace-validation";

function appWith(run: (limit: number) => Promise<unknown>) {
  const app = express();
  app.use(express.json());
  app.use(createGoogleWorkspaceValidationRouter({ service: { run } }));
  return app;
}

describe("Google Workspace recent validation route", () => {
  it("runs a bounded 100-item validation sample", async () => {
    const run = vi.fn(async (limit: number) => ({
      checkedLimit: limit,
      aiEnabled: false,
      historicalImportStarted: false,
      counts: { discovered: 0, matched: 0, needsReview: 0, ignored: 0 },
      matched: [],
      needsReview: [],
      ignored: [],
    }));

    const response = await request(appWith(run))
      .post("/google-workspace/validation/recent")
      .send({ limit: 100 });

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(100);
    expect(response.body.aiEnabled).toBe(false);
    expect(response.body.historicalImportStarted).toBe(false);
  });

  it("rejects attempts to expand the validation sample beyond 100", async () => {
    const run = vi.fn(async () => ({}));
    const response = await request(appWith(run))
      .post("/google-workspace/validation/recent")
      .send({ limit: 101 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "GOOGLE_WORKSPACE_VALIDATION_INPUT_INVALID" });
    expect(run).not.toHaveBeenCalled();
  });
});
