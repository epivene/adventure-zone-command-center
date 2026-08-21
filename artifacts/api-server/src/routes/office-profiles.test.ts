import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  verifyOfficeToken: vi.fn(),
  listProfiles: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/office/office-account-repository", () => ({
  DrizzleOfficeAccountRepository: class { getActiveSession = mocks.getActiveSession; },
}));
vi.mock("@/features/office/office-auth", () => ({ verifyOfficeToken: mocks.verifyOfficeToken }));
vi.mock("@/features/office/office-profile-service", () => ({
  OfficeProfileService: class {
    listProfiles = mocks.listProfiles;
    getProfile = mocks.getProfile;
  },
}));

import router from "./office-profiles";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(router);
  return instance;
}

const accountId = "10000000-0000-4000-8000-000000000001";
const profileId = "20000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyOfficeToken.mockReturnValue({ accountId, sessionVersion: 1, expiresAtMs: Date.now() + 10000 });
  mocks.getActiveSession.mockResolvedValue({ id: accountId, displayName: "Amy", role: "office_coordinator", enabled: true, sessionVersion: 1 });
  mocks.listProfiles.mockResolvedValue({ records: [], total: 0, page: 1, pageCount: 1 });
  mocks.getProfile.mockResolvedValue({ id: profileId, name: "County Fair" });
});

describe("office profile routes", () => {
  it("searches normal live profiles without exposing owner filters", async () => {
    const response = await request(app())
      .get("/office/profiles?q=county&page=2")
      .set("Authorization", "Bearer office-token");
    expect(response.status).toBe(200);
    expect(mocks.listProfiles).toHaveBeenCalledWith({ search: "county", page: 2 });
  });

  it("loads one projected profile", async () => {
    const response = await request(app())
      .get(`/office/profiles/${profileId}`)
      .set("Authorization", "Bearer office-token");
    expect(response.status).toBe(200);
    expect(response.body.profile).toEqual({ id: profileId, name: "County Fair" });
  });
});
