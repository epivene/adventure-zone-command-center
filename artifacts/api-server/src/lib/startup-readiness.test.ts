import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import {
  markAppReady,
  markAppStarting,
  requireStartupReadiness,
} from "./startup-readiness";

function createApp() {
  const app = express();
  app.use(requireStartupReadiness);
  app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/protected", (_req, res) => res.json({ status: "ready" }));
  return app;
}

afterEach(() => markAppReady());

describe("startup readiness gate", () => {
  it("opens the liveness route but rejects business traffic during required startup", async () => {
    markAppStarting();
    const app = createApp();

    await request(app).get("/api/healthz").expect(200, { status: "ok" });
    const response = await request(app).get("/api/protected").expect(503);

    expect(response.headers["retry-after"]).toBe("5");
    expect(response.body).toEqual({
      error: "STARTUP_IN_PROGRESS",
      message: "The API is completing required database startup checks.",
    });
  });

  it("allows business traffic after required startup completes", async () => {
    markAppStarting();
    markAppReady();

    await request(createApp())
      .get("/api/protected")
      .expect(200, { status: "ready" });
  });
});