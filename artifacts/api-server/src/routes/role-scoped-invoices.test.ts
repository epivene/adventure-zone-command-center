import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("./office-invoices", () => {
  const router = express.Router();
  router.get("/office/invoices", (_req, res) => res.status(210).end());
  router.get("/office/contracts/workspace", (_req, res) => res.status(211).end());
  return { default: router };
});
vi.mock("./boss-invoices", () => {
  const router = express.Router();
  router.get("/boss/invoices", (_req, res) => res.status(212).end());
  router.get("/boss/contracts/workspace", (_req, res) => res.status(213).end());
  return { default: router };
});

import { mountRoleScopedInvoiceRoutes } from "./role-scoped-invoices";

describe("role-scoped invoice routes", () => {
  it("handles role-scoped tracker paths before applying the owner-only gate", async () => {
    const app = express();
    mountRoleScopedInvoiceRoutes(app, (req, res, next) => {
      if (req.headers.authorization === "Bearer owner") return next();
      return res.status(401).json({ error: "Owner authentication required" });
    });
    app.get("/invoices", (_req, res) => res.status(214).end());

    const [officeInvoices, officeContracts, bossInvoices, bossContracts, ownerDenied, ownerAllowed] = await Promise.all([
      request(app).get("/office/invoices"),
      request(app).get("/office/contracts/workspace"),
      request(app).get("/boss/invoices"),
      request(app).get("/boss/contracts/workspace"),
      request(app).get("/invoices"),
      request(app).get("/invoices").set("Authorization", "Bearer owner"),
    ]);

    expect([
      officeInvoices.status,
      officeContracts.status,
      bossInvoices.status,
      bossContracts.status,
      ownerDenied.status,
      ownerAllowed.status,
    ]).toEqual([210, 211, 212, 213, 401, 214]);
  });
});
