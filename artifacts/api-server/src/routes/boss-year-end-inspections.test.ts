import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/test"; });

import { createBossYearEndInspectionsRouter } from "./boss-year-end-inspections";

describe("boss year-end inspection routes", () => {
  it("requires boss middleware before returning inspection evidence", async () => {
    const service = { get: vi.fn(async () => ({ id: "10000000-0000-4000-8000-000000000001" })) };
    const app = express();
    app.use(createBossYearEndInspectionsRouter({
      requireBoss(_req, res, _next) {
        res.status(401).json({ error: "Boss authentication required" });
      },
      service: service as never,
    }));
    await request(app).get("/boss/year-end-inspections/10000000-0000-4000-8000-000000000001").expect(401);
    expect(service.get).not.toHaveBeenCalled();
  });
});
