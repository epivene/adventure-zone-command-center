import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findPrimary: vi.fn(),
  createPrimary: vi.fn(),
  getActiveSession: vi.fn(),
  incrementSessionVersion: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: {} }));
vi.mock("@/features/owner-auth/owner-account-repository", () => ({
  PostgresOwnerAccountRepository: class {
    findPrimary = mocks.findPrimary;
    createPrimary = mocks.createPrimary;
    getActiveSession = mocks.getActiveSession;
    incrementSessionVersion = mocks.incrementSessionVersion;
  },
}));
vi.mock("@/lib/password-credential", () => ({
  verifyPasswordCredential: mocks.verifyPassword,
  hashPasswordCredential: mocks.hashPassword,
}));

import router from "./auth";

const previousSecret = process.env.SESSION_SECRET;
const previousPassword = process.env.OWNER_PASSWORD;
const owner = {
  id: "30000000-0000-4000-8000-000000000001",
  loginName: "desiree",
  displayName: "Desiree",
  role: "owner" as const,
  passwordHash: "owner-hash",
  passwordSalt: "owner-salt",
  enabled: true,
  sessionVersion: 3,
};

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(router);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSION_SECRET = "owner-route-test-secret";
  process.env.OWNER_PASSWORD = "existing-owner-password";
  mocks.findPrimary.mockResolvedValue(owner);
  mocks.createPrimary.mockResolvedValue(owner);
  mocks.getActiveSession.mockResolvedValue(owner);
  mocks.incrementSessionVersion.mockResolvedValue(true);
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.hashPassword.mockResolvedValue({ hash: owner.passwordHash, salt: owner.passwordSalt });
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
  if (previousPassword === undefined) delete process.env.OWNER_PASSWORD;
  else process.env.OWNER_PASSWORD = previousPassword;
});

describe("owner auth routes", () => {
  it("signs in the one database-backed owner and returns no credential fields", async () => {
    const response = await request(app()).post("/auth/login").send({ password: "owner-password" });

    expect(response.status).toBe(200);
    expect(mocks.verifyPassword).toHaveBeenCalledWith(
      "owner-password",
      owner.passwordHash,
      owner.passwordSalt,
    );
    expect(response.body.token).toMatch(/^owner\./);
    expect(response.body.owner).toEqual({ id: owner.id, displayName: "Desiree", role: "owner" });
    expect(response.body.owner).not.toHaveProperty("passwordHash");
    expect(response.body.owner).not.toHaveProperty("sessionVersion");
    expect(mocks.createPrimary).not.toHaveBeenCalled();
  });

  it("bootstraps Desiree from OWNER_PASSWORD only when no owner exists", async () => {
    mocks.findPrimary.mockResolvedValueOnce(null);

    const response = await request(app())
      .post("/auth/login")
      .send({ password: "existing-owner-password" });

    expect(response.status).toBe(200);
    expect(mocks.hashPassword).toHaveBeenCalledWith("existing-owner-password");
    expect(mocks.createPrimary).toHaveBeenCalledWith({
      loginName: "desiree",
      displayName: "Desiree",
      passwordHash: owner.passwordHash,
      passwordSalt: owner.passwordSalt,
    });
  });

  it("does not expose registration or bootstrap a second owner", async () => {
    mocks.verifyPassword.mockResolvedValueOnce(false);
    expect(
      (await request(app()).post("/auth/login").send({ password: "existing-owner-password" })).status,
    ).toBe(401);
    expect(mocks.createPrimary).not.toHaveBeenCalled();

    expect(
      (await request(app()).post("/auth/register").send({ password: "new-owner" })).status,
    ).toBe(404);
  });

  it("validates the owner against the current database session on /me", async () => {
    const login = await request(app()).post("/auth/login").send({ password: "owner-password" });
    const token = login.body.token as string;

    const current = await request(app()).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(current.status).toBe(200);
    expect(current.body.owner).toEqual({ id: owner.id, displayName: "Desiree", role: "owner" });

    mocks.getActiveSession.mockResolvedValueOnce({ ...owner, sessionVersion: 4 });
    expect(
      (await request(app()).get("/auth/me").set("Authorization", `Bearer ${token}`)).status,
    ).toBe(401);
  });

  it("revokes every existing owner token through a session-version increment", async () => {
    const login = await request(app()).post("/auth/login").send({ password: "owner-password" });
    const token = login.body.token as string;

    const revoked = await request(app())
      .post("/auth/sign-out-all")
      .set("Authorization", `Bearer ${token}`);
    expect(revoked.status).toBe(200);
    expect(mocks.incrementSessionVersion).toHaveBeenCalledWith(owner.id);

    mocks.getActiveSession.mockResolvedValueOnce({ ...owner, sessionVersion: 4 });
    expect(
      (await request(app()).get("/auth/me").set("Authorization", `Bearer ${token}`)).status,
    ).toBe(401);
  });
});
