import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findByLogin: vi.fn(),
  getActiveSession: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/office/office-account-repository", () => ({
  DrizzleOfficeAccountRepository: class {
    findByLogin = mocks.findByLogin;
    getActiveSession = mocks.getActiveSession;
  },
}));
vi.mock("@/lib/password-credential", () => ({ verifyPasswordCredential: mocks.verifyPassword }));

import router from "./office-auth";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(router);
  return instance;
}

const account = {
  id: "10000000-0000-4000-8000-000000000001",
  loginName: "amy",
  displayName: "Amy",
  role: "office_coordinator",
  passwordHash: "hash",
  passwordSalt: "salt",
  enabled: true,
  canReviewWebsiteInquiries: true,
  sessionVersion: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSION_SECRET = "office-route-test-secret";
  mocks.findByLogin.mockResolvedValue(account);
  mocks.getActiveSession.mockResolvedValue(account);
  mocks.verifyPassword.mockResolvedValue(true);
});

describe("office auth routes", () => {
  it("signs in a named enabled office account", async () => {
    const response = await request(app()).post("/office/auth/login").send({ loginName: " Amy ", password: "secret-pass" });
    expect(response.status).toBe(200);
    expect(mocks.findByLogin).toHaveBeenCalledWith("Amy");
    expect(response.body.token).toMatch(/^office\./);
    expect(response.body.office).toEqual({
      id: account.id,
      displayName: "Amy",
      role: "office_coordinator",
      canReviewWebsiteInquiries: true,
    });
    expect(response.body.office).not.toHaveProperty("passwordHash");
  });

  it("rejects incorrect credentials and disabled accounts", async () => {
    mocks.verifyPassword.mockResolvedValueOnce(false);
    expect((await request(app()).post("/office/auth/login").send({ loginName: "amy", password: "wrong-pass" })).status).toBe(401);

    mocks.findByLogin.mockResolvedValueOnce({ ...account, enabled: false });
    expect((await request(app()).post("/office/auth/login").send({ loginName: "amy", password: "secret-pass" })).status).toBe(401);
  });

  it("validates the current database session version on /me", async () => {
    const login = await request(app()).post("/office/auth/login").send({ loginName: "amy", password: "secret-pass" });
    const token = login.body.token as string;

    expect((await request(app()).get("/office/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    mocks.getActiveSession.mockResolvedValueOnce({ ...account, sessionVersion: 4 });
    expect((await request(app()).get("/office/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
  });
});
