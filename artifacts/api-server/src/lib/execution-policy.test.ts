import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { executionPolicy } from "./execution-policy";
describe("lean execution policy", () => {
  function app(env: NodeJS.ProcessEnv = {}) {
    const app = express();
    app.use(executionPolicy(() => env));
    app.use((_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }
  it.each([
    "/assistant/workspace/runs",
    "/assistant/commands",
    "/ai-suggestions/analyze",
    "/migration/act/start",
    "/migration/act-replacement/runs",
    "/act-recovery/runs",
  ])("blocks retired execution at %s by default", async (path) =>
    expect((await request(app()).post(path)).status).toBe(410),
  );
  it.each([
    "/follow-ups/id/snooze",
    "/com/draft-context",
    "/public/website-inquiries",
    "/website-inquiries",
    "/event-profiles",
    "/business-documents",
    "/contacts",
    "/today",
    "/chatgpt/mcp",
    "/opportunities/id/draft/send",
    "/opportunities/id/draft/schedule",
  ])("preserves normal API traffic at %s", async (path) =>
    expect((await request(app()).post(path)).status).toBe(200),
  );
  it("disables read-only Act tooling without removing imported CRM history", async () =>
    expect(
      (await request(app()).get("/migration/act-replacement/runs/latest"))
        .status,
    ).toBe(410));
  it("ignores stale opt-in flags", async () =>
    expect(
      (
        await request(app({ INTERNAL_AI_ENABLED: "true" })).post(
          "/assistant/workspace/runs",
        )
      ).status,
    ).toBe(410));
});
