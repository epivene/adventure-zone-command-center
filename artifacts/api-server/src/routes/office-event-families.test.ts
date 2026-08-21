import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  verifyOfficeToken: vi.fn(),
  getFamily: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/office/office-account-repository", () => ({
  DrizzleOfficeAccountRepository: class { getActiveSession = mocks.getActiveSession; },
}));
vi.mock("@/features/office/office-auth", () => ({ verifyOfficeToken: mocks.verifyOfficeToken }));
vi.mock("@/features/event-families/event-family-repository", () => ({
  EventFamilyRepository: class { getFamily = mocks.getFamily; },
}));

import router from "./office-event-families";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(router);
  return instance;
}

const accountId = "10000000-0000-4000-8000-000000000001";
const familyId = "20000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyOfficeToken.mockReturnValue({ accountId, sessionVersion: 1, expiresAtMs: Date.now() + 10000 });
  mocks.getActiveSession.mockResolvedValue({ id: accountId, displayName: "Amy", role: "office_coordinator", enabled: true, sessionVersion: 1 });
  mocks.getFamily.mockResolvedValue({
    id: familyId,
    name: "Water Lantern Festival",
    normalizedName: "water lantern festival",
    description: "Related festival locations",
    memberCount: 2,
    members: [
      { id: "30000000-0000-4000-8000-000000000001", name: "Water Lantern - Fargo", city: "Fargo", region: "ND", placeType: "festival_event", contactCount: 2, bookingCount: 1, nextFollowUpAt: new Date() },
      { id: "30000000-0000-4000-8000-000000000002", name: "Water Lantern - Bismarck", city: "Bismarck", region: "ND", placeType: "festival_event", contactCount: 1, bookingCount: 2, nextFollowUpAt: new Date() },
    ],
  });
});

describe("office event family route", () => {
  it("returns only safe family/member summary fields", async () => {
    const response = await request(app())
      .get(`/office/event-families/${familyId}`)
      .set("Authorization", "Bearer office-token");

    expect(response.status).toBe(200);
    expect(response.body.family).toMatchObject({ name: "Water Lantern Festival", memberCount: 2 });
    expect(response.body.family.members[0]).toEqual({
      id: "30000000-0000-4000-8000-000000000001",
      name: "Water Lantern - Fargo",
      city: "Fargo",
      region: "ND",
      contactCount: 2,
      bookingCount: 1,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/normalizedName|placeType|nextFollowUpAt|travelLeg|probability|lastResort/);
  });
});
