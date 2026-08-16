import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));

import { createEventWrapUpAdminRouter } from "./event-wrap-up-admin";

function app(deps: any) {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => { (req as any).userId = "owner"; next(); });
  instance.use(createEventWrapUpAdminRouter(deps));
  return instance;
}

function baseDeps() {
  return {
    service: {
      listSubmittedForAdmin: vi.fn(async () => [{ bookingId: "booking-a", status: "submitted" }]),
      loadAdminWrapUp: vi.fn(async () => ({ wrapUp: { bookingId: "booking-a", status: "submitted" }, sourceDataChanged: false })),
      saveAdminDraft: vi.fn(async () => ({ bookingId: "booking-a", status: "draft" })),
      reviewAdminWrapUp: vi.fn(async () => ({ bookingId: "booking-a", status: "reviewed" })),
      reopenAdminWrapUp: vi.fn(async () => ({ bookingId: "booking-a", status: "draft" })),
    },
    store: {
      saveTravelOverride: vi.fn(async (input: any) => ({ ...input, updatedAt: new Date() })),
      saveOverhead: vi.fn(async (input: any) => ({ ...input, updatedAt: new Date() })),
      addAdjustment: vi.fn(async (input: any) => ({ id: "adj-1", ...input, createdAt: new Date() })),
      deleteAdjustment: vi.fn(async () => true),
    },
    payload: vi.fn(async (_bookingId: string, result: any) => result),
    automaticMiles: vi.fn(async () => 123.4),
  };
}

describe("admin event wrap-up routes", () => {
  it("lists submitted wrap-ups", async () => {
    const deps = baseDeps();
    const response = await request(app(deps)).get("/event-wrap-up-admin");
    expect(response.status).toBe(200);
    expect(response.body.wrapUps).toHaveLength(1);
  });

  it("requires a reason for travel allocation overrides", async () => {
    const deps = baseDeps();
    const response = await request(app(deps)).put("/event-wrap-up-admin/booking-a/travel-allocation").send({ tripId: "11111111-1111-4111-8111-111111111111", overrideMiles: 100 });
    expect(response.status).toBe(400);
    expect(deps.store.saveTravelOverride).not.toHaveBeenCalled();
  });

  it("saves a documented travel allocation override", async () => {
    const deps = baseDeps();
    const response = await request(app(deps)).put("/event-wrap-up-admin/booking-a/travel-allocation").send({
      tripId: "11111111-1111-4111-8111-111111111111",
      overrideMiles: 100,
      overrideCostCents: 4500,
      reason: "Equipment detour",
    });
    expect(response.status).toBe(200);
    expect(deps.store.saveTravelOverride).toHaveBeenCalledWith({
      bookingId: "booking-a",
      tripId: "11111111-1111-4111-8111-111111111111",
      automaticMiles: 123.4,
      overrideMiles: 100,
      overrideCostCents: 4500,
      reason: "Equipment detour",
      updatedBy: "owner",
    });
  });

  it("requires a reason for overhead and signed adjustments", async () => {
    const deps = baseDeps();
    const overhead = await request(app(deps)).put("/event-wrap-up-admin/booking-a/overhead").send({ amountCents: 25000, label: "Season overhead" });
    const adjustment = await request(app(deps)).post("/event-wrap-up-admin/booking-a/adjustments").send({ scope: "direct", amountCents: -5000, label: "Refund" });
    expect(overhead.status).toBe(400);
    expect(adjustment.status).toBe(400);
    expect(deps.store.saveOverhead).not.toHaveBeenCalled();
    expect(deps.store.addAdjustment).not.toHaveBeenCalled();
  });

  it("reviews and reopens through admin-only lifecycle methods", async () => {
    const deps = baseDeps();
    const reviewed = await request(app(deps)).post("/event-wrap-up-admin/booking-a/review").send({});
    const reopened = await request(app(deps)).post("/event-wrap-up-admin/booking-a/reopen").send({});
    expect(reviewed.status).toBe(200);
    expect(reopened.status).toBe(200);
    expect(deps.service.reviewAdminWrapUp).toHaveBeenCalledWith("booking-a", "owner");
    expect(deps.service.reopenAdminWrapUp).toHaveBeenCalledWith("booking-a", "owner");
  });
});
