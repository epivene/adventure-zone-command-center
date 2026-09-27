import { it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createProfileTaskRouter } from "./assistant-workspace-tasks";
it("disabled task endpoints reject before constructing runtime", async () => {
  let calls = 0;
  const app = express();
  app.use(express.json());
  app.use((q, s, n) => {
    s.locals.actorId = "owner";
    n();
  });
  app.use(
    createProfileTaskRouter(
      () => {
        calls++;
        throw Error("must not construct");
      },
      () => false,
    ),
  );
  const response = await request(app).post("/tasks").send({});
  expect(response.status).toBe(404);
  expect(calls).toBe(0);
});
it("rejects oversized approval requests without mutation", async () => {
  const app = express();
  app.use(express.json());
  app.use((q, s, n) => {
    s.locals.actorId = "owner";
    n();
  });
  app.use(
    createProfileTaskRouter(
      () => ({}) as any,
      () => true,
    ),
  );
  app.use((e: any, q: any, s: any, n: any) =>
    s.status(400).json({ error: e.message }),
  );
  const r = await request(app)
    .post("/tasks/11111111-1111-4111-8111-111111111111/approvals")
    .send({
      requestKey: "x",
      expectedVersion: 1,
      actions: Array(5).fill({
        id: "11111111-1111-4111-8111-111111111111",
        revision: null,
      }),
    });
  expect(r.status).toBe(400);
});
it("returns 409 for a stale review version before executing actions", async () => {
  const app = express();
  app.use(express.json());
  app.use((q, s, n) => {
    s.locals.actorId = "owner";
    n();
  });
  app.use(
    createProfileTaskRouter(
      () =>
        ({
          profileTasks: {
            get: async () => ({ version: 2, state: "waiting_review" }),
          },
        }) as any,
      () => true,
    ),
  );
  const r = await request(app)
    .post("/tasks/11111111-1111-4111-8111-111111111111/approvals")
    .send({
      requestKey: "stale",
      expectedVersion: 1,
      actions: [{ id: "11111111-1111-4111-8111-111111111111", revision: null }],
    });
  expect(r.status).toBe(409);
});
