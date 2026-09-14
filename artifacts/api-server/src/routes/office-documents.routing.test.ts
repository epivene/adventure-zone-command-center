import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/db")>()),
  db: {},
}));

import officeDocumentsRouter from "./office-documents";

function appWithDownstreamStudioRoute() {
  const app = express();
  app.use(officeDocumentsRouter);
  app.get("/office/design-studio/projects", (_req, res) => {
    res.status(200).json({ projects: [] });
  });
  return app;
}

describe("Office document route boundary", () => {
  it("does not apply Office-only authentication to Design Studio routes", async () => {
    const response = await request(appWithDownstreamStudioRoute())
      .get("/office/design-studio/projects")
      .set("Authorization", "Bearer owner-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ projects: [] });
  });

  it("still requires an Office session for Office business documents", async () => {
    const response = await request(appWithDownstreamStudioRoute())
      .get("/office/business-documents");

    expect(response.status).toBe(401);
  });
});
