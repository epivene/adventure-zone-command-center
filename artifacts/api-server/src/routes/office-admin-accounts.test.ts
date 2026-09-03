import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAdmin: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  setPassword: vi.fn(),
  incrementSessionVersion: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/office/office-account-repository", () => ({
  DrizzleOfficeAccountRepository: class {
    listAdmin = mocks.listAdmin;
    createAccount = mocks.createAccount;
    updateAccount = mocks.updateAccount;
    setPassword = mocks.setPassword;
    incrementSessionVersion = mocks.incrementSessionVersion;
  },
}));
vi.mock("@/lib/password-credential", () => ({ hashPasswordCredential: mocks.hashPassword }));

import router from "./office-admin-accounts";

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
  enabled: true,
  canReviewWebsiteInquiries: false,
  sessionVersion: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAdmin.mockResolvedValue([account]);
  mocks.createAccount.mockResolvedValue(account);
  mocks.updateAccount.mockResolvedValue(account);
  mocks.setPassword.mockResolvedValue({ ...account, sessionVersion: 2 });
  mocks.incrementSessionVersion.mockResolvedValue(true);
  mocks.hashPassword.mockResolvedValue({ hash: "hash", salt: "salt" });
});

describe("office account administration", () => {
  it("creates an Office Coordinator without returning credentials", async () => {
    const response = await request(app()).post("/office-admin/accounts").send({
      loginName: "amy",
      displayName: "Amy",
      password: "long-enough-password",
    });
    expect(response.status).toBe(201);
    expect(mocks.createAccount).toHaveBeenCalledWith(expect.objectContaining({
      loginName: "amy",
      displayName: "Amy",
      passwordHash: "hash",
      passwordSalt: "salt",
    }));
    expect(response.body.account).not.toHaveProperty("passwordHash");
    expect(response.body.account).not.toHaveProperty("passwordSalt");
  });

  it("resets a password through the repository session-version path", async () => {
    const response = await request(app())
      .put(`/office-admin/accounts/${account.id}/password`)
      .send({ password: "replacement-password" });
    expect(response.status).toBe(200);
    expect(mocks.setPassword).toHaveBeenCalledWith(account.id, "hash", "salt");
  });

  it("revokes all active sessions on request", async () => {
    const response = await request(app()).post(`/office-admin/accounts/${account.id}/sign-out-all`).send({});
    expect(response.status).toBe(200);
    expect(mocks.incrementSessionVersion).toHaveBeenCalledWith(account.id);
  });

  it("rejects unknown fields instead of expanding office-account authority", async () => {
    const response = await request(app()).patch(`/office-admin/accounts/${account.id}`).send({ role: "owner" });
    expect(response.status).toBe(400);
    expect(mocks.updateAccount).not.toHaveBeenCalled();
  });

  it("grants website inquiry review through an explicit permission", async () => {
    const response = await request(app())
      .patch(`/office-admin/accounts/${account.id}`)
      .send({ canReviewWebsiteInquiries: true });

    expect(response.status).toBe(200);
    expect(mocks.updateAccount).toHaveBeenCalledWith(account.id, {
      canReviewWebsiteInquiries: true,
    });
  });
});
