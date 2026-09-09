import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));

import { createEarlyBirdPromoRouter } from "./early-bird-promo";

const enrollmentId = "10000000-0000-4000-8000-000000000001";
const organizationId = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-24T16:00:00.000Z");

function enrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: enrollmentId,
    organizationId,
    bookingId: null,
    eventYear: 2027,
    status: "active",
    firstSentAt: new Date("2026-09-09T16:00:00.000Z"),
    deadlineDate: "2026-10-21",
    interestConfirmedAt: null,
    reminderDueAt: null,
    reminderDraftId: null,
    depositReceivedAt: null,
    cancelReason: null,
    ...overrides,
  };
}

function appWith(input: {
  getForProfileYear?: ReturnType<typeof vi.fn>;
  confirmEnrollmentInterest?: ReturnType<typeof vi.fn>;
  recordEnrollmentDeposit?: ReturnType<typeof vi.fn>;
  cancel?: ReturnType<typeof vi.fn>;
}) {
  const app = express();
  app.use(express.json());
  app.use(createEarlyBirdPromoRouter({
    repository: { getForProfileYear: input.getForProfileYear ?? vi.fn() } as any,
    service: {
      confirmEnrollmentInterest: input.confirmEnrollmentInterest ?? vi.fn(),
      recordEnrollmentDeposit: input.recordEnrollmentDeposit ?? vi.fn(),
      cancel: input.cancel ?? vi.fn(),
    } as any,
    now: () => now,
  }));
  return app;
}

describe("Early Bird Promo owner routes", () => {
  it("returns the profile-year enrollment used by the profile card", async () => {
    const getForProfileYear = vi.fn().mockResolvedValue(enrollment());
    const response = await request(appWith({ getForProfileYear }))
      .get(`/early-bird-promo/profile/${organizationId}?eventYear=2027`);

    expect(response.status).toBe(200);
    expect(response.body.promotion).toMatchObject({
      id: enrollmentId,
      name: "Early Bird Promo",
      deadlineDate: "2026-10-21",
      status: "active",
    });
    expect(getForProfileYear).toHaveBeenCalledWith(organizationId, 2027);
  });

  it("confirms interest against the enrollment without moving its deadline", async () => {
    const confirmEnrollmentInterest = vi.fn().mockResolvedValue(enrollment({
      interestConfirmedAt: now,
      reminderDueAt: now,
    }));
    const response = await request(appWith({ confirmEnrollmentInterest }))
      .post(`/early-bird-promo/${enrollmentId}/interest`)
      .send({ evidenceMessageId: "reply-123" });

    expect(response.status).toBe(200);
    expect(confirmEnrollmentInterest).toHaveBeenCalledWith({
      enrollmentId,
      confirmedAt: now,
      evidenceMessageId: "reply-123",
    });
  });

  it("records a deposit by enrollment and cancels its pending reminder", async () => {
    const recordEnrollmentDeposit = vi.fn().mockResolvedValue(enrollment({
      status: "secured",
      depositReceivedAt: now,
    }));
    const response = await request(appWith({ recordEnrollmentDeposit }))
      .post(`/early-bird-promo/${enrollmentId}/deposit`)
      .send({ source: "owner_profile" });

    expect(response.status).toBe(200);
    expect(recordEnrollmentDeposit).toHaveBeenCalledWith({
      enrollmentId,
      receivedAt: now,
      source: "owner_profile",
    });
  });

  it("requires a reason when the owner cancels an enrollment", async () => {
    const cancel = vi.fn();
    const invalid = await request(appWith({ cancel }))
      .post(`/early-bird-promo/${enrollmentId}/cancel`)
      .send({ reason: "" });
    expect(invalid.status).toBe(400);

    cancel.mockResolvedValue(enrollment({ status: "cancelled", cancelReason: "Customer declined" }));
    const response = await request(appWith({ cancel }))
      .post(`/early-bird-promo/${enrollmentId}/cancel`)
      .send({ reason: "Customer declined" });
    expect(response.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith({
      enrollmentId,
      reason: "Customer declined",
      cancelledAt: now,
    });
  });
});
