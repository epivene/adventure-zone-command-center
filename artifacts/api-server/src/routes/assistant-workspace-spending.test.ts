import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createAssistantWorkspaceRouter } from "./assistant-workspace";
import { issueToken } from "../lib/auth";
const prior = { ...process.env };
afterEach(() => {
  process.env = { ...prior };
});
function fixture() {
  Object.assign(process.env, {
    SESSION_SECRET: "assistant-test-session-secret",
    OWNER_PASSWORD: "test",
    ASSISTANT_WORKSPACE_ENABLED: "true",
    ASSISTANT_WORKSPACE_ACTOR_IDS: "owner",
    ASSISTANT_OPENAI_MODEL: "gpt-6-sol",
    OPENAI_API_KEY: "fake-key",
  });
  const summary = vi.fn().mockResolvedValue({
    version: 1,
    dailyLimitUsd: 1,
    economyMode: true,
    paused: false,
    spentUsd: 0.25,
    reservedUsd: 0.1,
    remainingUsd: 0.65,
  });
  const update = vi.fn().mockResolvedValue({
    version: 2,
    dailyLimitUsd: 0,
    economyMode: true,
    paused: true,
  });
  const submit = vi.fn();
  const findSubmitted = vi.fn().mockResolvedValue(null);
  const app = express();
  app.use(express.json());
  const runtime = {
    spending: { summary, update },
    config: { models: ["gpt-6-sol", "gpt-6-luna"], model: "gpt-6-sol" },
    conversations: {
      get: vi
        .fn()
        .mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" }),
    },
    runs: { submit, findSubmitted },
  };
  app.use(
    createAssistantWorkspaceRouter(() => runtime as any, {
      startup: () => "ready",
    }),
  );
  return {
    app,
    summary,
    update,
    submit,
    findSubmitted,
    authorization: `Bearer ${issueToken()!.token}`,
  };
}
it("only authenticated owners can read or edit spending; actor and ledger fields cannot be injected", async () => {
  const f = fixture();
  expect((await request(f.app).get("/spending")).status).toBe(401);
  expect(
    (
      await request(f.app)
        .patch("/spending")
        .send({ version: 1, dailyLimitUsd: 0, economyMode: true })
    ).status,
  ).toBe(401);
  expect(f.summary).not.toHaveBeenCalled();
  expect(f.update).not.toHaveBeenCalled();
  const read = await request(f.app)
    .get("/spending")
    .set("Authorization", f.authorization);
  expect(read.status).toBe(200);
  expect(read.headers["cache-control"]).toBe("no-store");
  expect(read.body).toMatchObject({
    economyModel: "gpt-6-luna",
    remainingUsd: 0.65,
  });
  expect(f.summary).toHaveBeenCalledWith("owner");
  const bad = await request(f.app)
    .patch("/spending")
    .set("Authorization", f.authorization)
    .send({
      version: 1,
      dailyLimitUsd: 0,
      economyMode: true,
      actorId: "other",
      spentUsd: 0,
    });
  expect(bad.status).toBe(422);
  expect(f.update).not.toHaveBeenCalled();
  const saved = await request(f.app)
    .patch("/spending")
    .set("Authorization", f.authorization)
    .send({ version: 1, dailyLimitUsd: 0, economyMode: true });
  expect(saved.status).toBe(200);
  expect(saved.body.paused).toBe(true);
  expect(f.update).toHaveBeenCalledWith("owner", {
    version: 1,
    dailyLimitUsd: 0,
    economyMode: true,
  });
});
it("preserves a specific edit conflict and rejects invalid limits", async () => {
  const f = fixture();
  f.update.mockRejectedValue(new Error("ASSISTANT_SPENDING_CONFLICT"));
  const conflict = await request(f.app)
    .patch("/spending")
    .set("Authorization", f.authorization)
    .send({ version: 1, dailyLimitUsd: 2, economyMode: false });
  expect(conflict.status).toBe(409);
  expect(conflict.body.code).toBe("ASSISTANT_SPENDING_CONFLICT");
  for (const dailyLimitUsd of [-1, 1001, "unlimited"])
    expect(
      (
        await request(f.app)
          .patch("/spending")
          .set("Authorization", f.authorization)
          .send({ version: 1, dailyLimitUsd, economyMode: true })
      ).status,
    ).toBe(422);
});
it("a paused allowance rejects a new paid chat before queueing or touching Gmail", async () => {
  const f = fixture();
  f.summary.mockResolvedValue({ paused: true });
  const response = await request(f.app)
    .post("/conversations/11111111-1111-4111-8111-111111111111/messages")
    .set("Authorization", f.authorization)
    .send({
      text: "Continue",
      requestKey: "22222222-2222-4222-8222-222222222222",
      model: "gpt-6-sol",
    });
  expect(response.status).toBe(409);
  expect(response.body.code).toBe("ASSISTANT_BUDGET_LIMIT");
  expect(f.submit).not.toHaveBeenCalled();
});
it("returns an already accepted request even when its spending exhausted the allowance", async () => {
  const f = fixture();
  f.summary.mockResolvedValue({ paused: true });
  f.findSubmitted.mockResolvedValue({ id: "prior-run", status: "partial" });
  const response = await request(f.app)
    .post("/conversations/11111111-1111-4111-8111-111111111111/messages")
    .set("Authorization", f.authorization)
    .send({
      text: "Continue",
      requestKey: "22222222-2222-4222-8222-222222222222",
      model: "gpt-6-sol",
    });
  expect(response.status).toBe(202);
  expect(response.body).toEqual({ runId: "prior-run", status: "partial" });
  expect(f.summary).not.toHaveBeenCalled();
  expect(f.submit).not.toHaveBeenCalled();
  expect(f.findSubmitted).toHaveBeenCalledWith(
    "owner",
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "Continue",
    [],
  );
});
it("a read-only reconciliation cannot start paid work when the original never arrived and allowance is available", async () => {
  const f = fixture();
  f.findSubmitted.mockResolvedValue(null);
  const response = await request(f.app)
    .post("/conversations/11111111-1111-4111-8111-111111111111/messages")
    .set("Authorization", f.authorization)
    .send({
      text: "Continue",
      requestKey: "22222222-2222-4222-8222-222222222222",
      model: "gpt-6-sol",
      reconcileOnly: true,
    });
  expect(response.status).toBe(404);
  expect(response.body.code).toBe("ASSISTANT_REQUEST_NOT_FOUND");
  expect(f.summary).not.toHaveBeenCalled();
  expect(f.submit).not.toHaveBeenCalled();
});

it("accepts an owner monthly limit and rejects invalid monthly values", async () => {
  const f = fixture();
  const response = await request(f.app)
    .patch("/spending")
    .set("Authorization", f.authorization)
    .send({
      version: 1,
      dailyLimitUsd: 1,
      monthlyLimitUsd: 12.5,
      economyMode: true,
    });
  expect(response.status).toBe(200);
  expect(f.update).toHaveBeenCalledWith("owner", {
    version: 1,
    dailyLimitUsd: 1,
    monthlyLimitUsd: 12.5,
    economyMode: true,
  });
  for (const monthlyLimitUsd of [-1, 1001, null, "10"]) {
    const invalid = await request(f.app)
      .patch("/spending")
      .set("Authorization", f.authorization)
      .send({
        version: 1,
        dailyLimitUsd: 1,
        monthlyLimitUsd,
        economyMode: true,
      });
    expect(invalid.status).toBe(422);
  }
});
