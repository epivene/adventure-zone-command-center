import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAssistantBlandingKristyCorrectionRouter } from "./assistant-blanding-kristy-correction";

function app(correct: () => Promise<any>) {
  const server = express();
  server.use(express.json());
  server.use(createAssistantBlandingKristyCorrectionRouter({ correct }));
  return server;
}

describe("assistant Blanding Kristy correction route", () => {
  beforeEach(() => {
    process.env.ASSISTANT_IMPORT_TOKEN = "test-assistant-token";
  });

  afterEach(() => {
    delete process.env.ASSISTANT_IMPORT_TOKEN;
    vi.restoreAllMocks();
  });

  it("requires the assistant bearer token before changing live event state", async () => {
    const correct = vi.fn(async () => ({ status: "already_current" }));

    const response = await request(app(correct))
      .post("/blanding-kristy-state-correction")
      .send({});

    expect(response.status).toBe(401);
    expect(correct).not.toHaveBeenCalled();
  });

  it("returns the exact applied correction result", async () => {
    const result = {
      status: "applied",
      bookingId: "00000000-0000-4000-8000-000000000020",
      organizationId: "00000000-0000-4000-8000-000000000030",
      legId: "00000000-0000-4000-8000-000000000010",
      gmailThreadId: "19d214e0a6d3f255",
      contacts: ["amitchell@sanjuancc.org", "ssherrow@sanjuancc.org"],
      mapReady: true,
    };
    const correct = vi.fn(async () => result);

    const response = await request(app(correct))
      .post("/blanding-kristy-state-correction")
      .set("Authorization", "Bearer test-assistant-token")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, result });
  });

  it("returns 409 when exact live identity checks refuse the correction", async () => {
    const result = {
      status: "skipped",
      reason: "booking_ambiguous",
      details: [],
    };

    const response = await request(app(async () => result))
      .post("/blanding-kristy-state-correction")
      .set("Authorization", "Bearer test-assistant-token")
      .send({});

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ ok: false, result });
  });
});
