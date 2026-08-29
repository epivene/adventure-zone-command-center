import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));

import { createManagerWrapUpRouter } from "./leg-manager-wrap-ups";

function app(service: any, payload = vi.fn(async (_bookingId: string, wrapUp: any) => ({ wrapUp, calculation: null, warnings: [] }))) {
  const instance = express();
  instance.use(express.json());
  const requireManager: express.RequestHandler = (req, _res, next) => {
    req.legManager = { legId: "leg-a", managerName: "Kristy" };
    next();
  };
  instance.use(createManagerWrapUpRouter({ service, requireManager, payload }));
  return instance;
}

function wrapUp(status = "draft") {
  return { id: "wrap-a", bookingId: "booking-a", legId: "leg-a", tripId: "trip-a", status, ratingStars: 4, ratingNotes: null, actualCashOnHandCents: 10000, cashDifferenceNote: null };
}

describe("manager event wrap-up routes", () => {
  it("loads only through the authenticated manager leg", async () => {
    const service = { loadManagerWrapUp: vi.fn(async () => wrapUp()) };
    const response = await request(app(service)).get("/manager/wrap-ups/booking-a");
    expect(response.status).toBe(200);
    expect(service.loadManagerWrapUp).toHaveBeenCalledWith("booking-a", "leg-a");
    expect(response.body.wrapUp.bookingId).toBe("booking-a");
  });

  it("returns 403 when the service rejects another leg's event", async () => {
    const service = { loadManagerWrapUp: vi.fn(async () => { throw new Error("Event is outside your leg"); }) };
    const response = await request(app(service)).get("/manager/wrap-ups/booking-b");
    expect(response.status).toBe(403);
  });

  it("saves a draft without accepting a client leg id as authority", async () => {
    const service = { saveManagerDraft: vi.fn(async () => wrapUp()) };
    const response = await request(app(service)).put("/manager/wrap-ups/booking-a").send({
      legId: "leg-b",
      ratingStars: 5,
      ratingNotes: "Great",
      actualCashOnHandCents: 12000,
      cashDifferenceNote: null,
    });
    expect(response.status).toBe(200);
    expect(service.saveManagerDraft).toHaveBeenCalledWith({
      bookingId: "booking-a",
      managerLegId: "leg-a",
      managerId: null,
      input: {
        ratingStars: 5,
        ratingNotes: "Great",
        actualCashOnHandCents: 12000,
        cashDifferenceNote: null,
      },
    });
  });

  it("submits an own-leg draft", async () => {
    const service = { submitManagerWrapUp: vi.fn(async () => wrapUp("submitted")) };
    const response = await request(app(service)).post("/manager/wrap-ups/booking-a/submit").send({});
    expect(response.status).toBe(200);
    expect(service.submitManagerWrapUp).toHaveBeenCalledWith({ bookingId: "booking-a", managerLegId: "leg-a", managerId: null });
    expect(response.body.wrapUp.status).toBe("submitted");
  });

  it("does not intercept unrelated manager routes with owner authentication", async () => {
    const response = await request(app({})).get("/manager/messages/conversations");
    expect(response.status).toBe(404);
  });
});
