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
  process.env.SESSION_SECRET = "assistant-test-session-secret";
  process.env.OWNER_PASSWORD = "test";
  process.env.ASSISTANT_WORKSPACE_ENABLED = "true";
  process.env.ASSISTANT_WORKSPACE_ACTOR_IDS = "owner";
  process.env.ASSISTANT_OPENAI_MODEL = "configured-model";
  process.env.OPENAI_API_KEY = "fake-key";
  const retire = vi
    .fn()
    .mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      status: "superseded",
      headVersion: 4,
    });
  const app = express();
  app.use(express.json());
  app.use(
    createAssistantWorkspaceRouter(() => ({ knowledge: { retire } }) as any, {
      startup: () => "ready",
    }),
  );
  return {
    app,
    retire,
    authorization: `Bearer ${issueToken()!.token}`,
    path: "/knowledge/11111111-1111-4111-8111-111111111111/retire",
  };
}
it("requires owner authentication and a reviewed version before retiring saved info", async () => {
  const f = fixture();
  expect(
    (await request(f.app).post(f.path).send({ expectedVersion: 3 })).status,
  ).toBe(401);
  expect(f.retire).not.toHaveBeenCalled();
  expect(
    (
      await request(f.app)
        .post(f.path)
        .set("Authorization", f.authorization)
        .send({ expectedVersion: 3, actorId: "other" })
    ).status,
  ).toBe(422);
  expect(f.retire).not.toHaveBeenCalled();
  const result = await request(f.app)
    .post(f.path)
    .set("Authorization", f.authorization)
    .send({ expectedVersion: 3 });
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ status: "superseded", headVersion: 4 });
  expect(f.retire).toHaveBeenCalledWith(
    "owner",
    "11111111-1111-4111-8111-111111111111",
    3,
  );
});
it("returns a conflict when remembered information changed before retirement", async () => {
  const f = fixture();
  f.retire.mockRejectedValue(new Error("ASSISTANT_RULE_VERSION_CONFLICT"));
  const result = await request(f.app)
    .post(f.path)
    .set("Authorization", f.authorization)
    .send({ expectedVersion: 2 });
  expect(result.status).toBe(409);
  expect(result.body.code).toBe("ASSISTANT_RULE_VERSION_CONFLICT");
});
