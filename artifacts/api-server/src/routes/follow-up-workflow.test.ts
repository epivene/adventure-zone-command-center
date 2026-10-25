import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createFollowUpWorkflowRouter } from "./follow-up-workflow";
import { WorkflowError } from "../features/follow-ups/workflow-types";

describe("follow-up workflow API", () => {
  const workflow = {
    list: async () => ({
      items: [],
      total: 0,
      counts: { needsNextStep: 0, overdue: 0, today: 0, upcoming: 0 },
    }),
    snooze: async () => {
      throw new WorkflowError(
        "STALE_REVISION",
        409,
        "This item changed. Refresh before trying again.",
      );
    },
    resolve: async () => ({ id: "saved" }),
    plan: async () => ({ nextFollowUpId: "planned" }),
  };
  function app() {
    const app = express();
    app.use(express.json());
    app.use(
      createFollowUpWorkflowRouter(workflow as never, (req, res, next) => {
        if (req.headers.authorization !== "Bearer owner") {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        next();
      }),
    );
    return app;
  }
  it("returns stale snooze as 409 for clients to refresh", async () => {
    const res = await request(app())
      .post("/follow-ups/30000000-0000-4000-8000-000000000001/snooze")
      .set("Authorization", "Bearer owner")
      .send({ expectedRevision: "old", dueAt: "2026-11-01T16:00:00Z" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("STALE_REVISION");
  });
  it("exposes one work queue contract", async () => {
    const res = await request(app())
      .get("/work-queue?bucket=needsNextStep")
      .set("Authorization", "Bearer owner");
    expect(res.status).toBe(200);
    expect(res.body.counts.needsNextStep).toBe(0);
  });
  it("requires owner authentication for reads and mutations", async () => {
    expect((await request(app()).get("/work-queue")).status).toBe(401);
    expect(
      (await request(app()).post("/follow-ups/any/snooze").send({})).status,
    ).toBe(401);
  });
});
