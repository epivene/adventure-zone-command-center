import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAssistantKristyReviewCorrectionRouter } from "./assistant-kristy-review-correction";

function app(correct: () => Promise<any>) {
  const server = express();
  server.use(express.json());
  server.use(createAssistantKristyReviewCorrectionRouter({ correct }));
  return server;
}

describe("assistant Kristy review correction route", () => {
  beforeEach(() => {
    process.env.ASSISTANT_IMPORT_TOKEN = "test-assistant-token";
  });

  afterEach(() => {
    delete process.env.ASSISTANT_IMPORT_TOKEN;
    vi.restoreAllMocks();
  });

  it("requires the assistant import bearer token before mutating live state", async () => {
    const correct = vi.fn(async () => ({ status: "already_current" }));

    const response = await request(app(correct))
      .post("/kristy-review-state-correction")
      .send({});

    expect(response.status).toBe(401);
    expect(correct).not.toHaveBeenCalled();
  });

  it("runs the exact correction and returns the applied result", async () => {
    const result = {
      status: "applied",
      legId: "0f495fb4-a2fe-473c-ae51-1e4a5e4d0a6d",
      restoredBookingIds: [
        "ff3dce3f-dad2-41a9-9ecf-c87bd448ed6f",
        "e082626f-1759-48b7-b77c-4d6188e42ee9",
        "21103588-3110-4a60-ac2c-d4f12655d5c5",
        "7320b7c9-91bf-4960-bda4-50b0d5b13815",
        "0ea10087-96ba-4268-8d32-b86a615a0896",
      ],
      donKingDays: "unassigned",
    };
    const correct = vi.fn(async () => result);

    const response = await request(app(correct))
      .post("/kristy-review-state-correction")
      .set("Authorization", "Bearer test-assistant-token")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, result });
    expect(correct).toHaveBeenCalledOnce();
  });

  it("returns 409 when exact live identity checks refuse the correction", async () => {
    const result = {
      status: "skipped",
      reason: "don_king_changed",
      details: { status: "confirmed" },
    };
    const correct = vi.fn(async () => result);

    const response = await request(app(correct))
      .post("/kristy-review-state-correction")
      .set("Authorization", "Bearer test-assistant-token")
      .send({});

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ ok: false, result });
  });

  it("returns sanitized PostgreSQL diagnostics behind the protected token", async () => {
    const databaseError = Object.assign(
      new Error("column assignment.assigned_leg_id does not exist"),
      {
        name: "error",
        code: "42703",
        table: "booking_leg_assignments",
        column: "assigned_leg_id",
        constraint: null,
        routine: "errorMissingColumn",
      },
    );
    const correct = vi.fn(async () => {
      throw databaseError;
    });

    const response = await request(app(correct))
      .post("/kristy-review-state-correction")
      .set("Authorization", "Bearer test-assistant-token")
      .send({});

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      ok: false,
      error: "Kristy review state correction failed.",
      diagnostic: {
        name: "error",
        message: "column assignment.assigned_leg_id does not exist",
        code: "42703",
        table: "booking_leg_assignments",
        column: "assigned_leg_id",
        constraint: null,
        routine: "errorMissingColumn",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("stack");
  });
});
