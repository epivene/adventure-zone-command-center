import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("./office-invoices", () => ({ default: express.Router() }));
vi.mock("./boss-invoices", () => {
  const router = express.Router();
  router.get("/boss/invoices", (_req, res) => res.status(204).end());
  return { default: router };
});

import { mountRoleScopedInvoiceRoutes } from "./role-scoped-invoices";

describe("role-scoped invoice routes", () => {
  it("lets the boss invoice router handle its path before an owner-only gate", async () => {
    const app = express();
    mountRoleScopedInvoiceRoutes(app);
    app.use((_req, res) => res.status(401).json({ error: "Owner authentication required" }));

    const response = await request(app).get("/boss/invoices");

    expect(response.status).toBe(204);
  });
});
