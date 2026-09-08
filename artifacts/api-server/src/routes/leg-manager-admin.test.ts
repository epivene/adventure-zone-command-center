import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAdminStatuses: vi.fn(),
  listConfiguredPasswordRecords: vi.fn(),
  setPassword: vi.fn(),
  incrementSessionVersion: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));

vi.mock("@/features/leg-manager/leg-manager-repository", () => ({
  DrizzleLegManagerRepository: class {
    listAdminStatuses = mocks.listAdminStatuses;
    listConfiguredPasswordRecords = mocks.listConfiguredPasswordRecords;
    setPassword = mocks.setPassword;
    incrementSessionVersion = mocks.incrementSessionVersion;
  },
}));

vi.mock("@/features/leg-manager/leg-manager-auth", () => ({
  hashLegManagerPassword: vi.fn(async () => ({ hash: "hash", salt: "salt" })),
  verifyLegManagerPassword: mocks.verifyPassword,
}));

import router from "./leg-manager-admin";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(router);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listConfiguredPasswordRecords.mockResolvedValue([]);
  mocks.verifyPassword.mockResolvedValue(false);
  mocks.setPassword.mockResolvedValue({
    legId: "leg-kristy",
    legName: "Kristy",
    passwordHash: "hash",
    passwordSalt: "salt",
    sessionVersion: 4,
  });
});

describe("manager admin access identity", () => {
  it("returns the travel-leg name and accepts password changes without managerName", async () => {
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

  it("rejects a password already used by another manager", async () => {
    mocks.listConfiguredPasswordRecords.mockResolvedValue([
      { legId: "leg-amy", passwordHash: "hash-amy", passwordSalt: "salt-amy" },
    ]);
    mocks.verifyPassword.mockResolvedValue(true);

    const response = await request(app())
      .put("/manager-admin/legs/leg-kristy/access")
      .send({ password: "shared-secret" });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe(
      "That password is already assigned to another manager. Choose a different password.",
    );
    expect(response.body).not.toHaveProperty("conflictingLegId");
    expect(mocks.setPassword).not.toHaveBeenCalled();
  });

  it("does not treat the current leg as a duplicate", async () => {
    mocks.listConfiguredPasswordRecords.mockResolvedValue([
      { legId: "leg-kristy", passwordHash: "hash-self", passwordSalt: "salt-self" },
    ]);

    const response = await request(app())
      .put("/manager-admin/legs/leg-kristy/access")
      .send({ password: "same-current-secret" });

    expect(response.status).toBe(200);
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.setPassword).toHaveBeenCalledTimes(1);
  });
  it("does not shadow the enriched event-review route", () => {
    const source = readFileSync("src/routes/leg-manager-admin.ts", "utf8");
    expect(source).not.toContain('router.get("/manager-admin/reviews"');
  });

});
