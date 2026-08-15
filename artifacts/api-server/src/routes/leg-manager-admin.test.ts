import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAdminStatuses: vi.fn(),
  setPassword: vi.fn(),
  incrementSessionVersion: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));

vi.mock("@/features/leg-manager/leg-manager-repository", () => ({
  DrizzleLegManagerRepository: class {
    listAdminStatuses = mocks.listAdminStatuses;
    setPassword = mocks.setPassword;
    incrementSessionVersion = mocks.incrementSessionVersion;
  },
}));

vi.mock("@/features/leg-manager/leg-manager-auth", () => ({
  hashLegManagerPassword: vi.fn(async () => ({ hash: "hash", salt: "salt" })),
}));

import router from "./leg-manager-admin";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(router);
  return instance;
}

beforeEach(() => vi.clearAllMocks());

describe("manager admin access identity", () => {
  it("returns the travel-leg name and accepts password changes without managerName", async () => {
    mocks.setPassword.mockResolvedValue({
      legId: "leg-kristy",
      legName: "Kristy",
      passwordHash: "hash",
      passwordSalt: "salt",
      sessionVersion: 4,
    });

    const response = await request(app())
      .put("/manager-admin/legs/leg-kristy/access")
      .send({ password: "new-secret" });

    expect(response.status).toBe(200);
    expect(mocks.setPassword).toHaveBeenCalledWith({
      legId: "leg-kristy",
      passwordHash: "hash",
      passwordSalt: "salt",
    });
    expect(response.body.access).toMatchObject({
      legId: "leg-kristy",
      legName: "Kristy",
      enabled: true,
      sessionVersion: 4,
    });
    expect(response.body.access).not.toHaveProperty("managerName");
  });
});
