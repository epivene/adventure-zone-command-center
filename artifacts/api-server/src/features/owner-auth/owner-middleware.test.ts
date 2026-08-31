import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { issueLegManagerToken } from "@/features/leg-manager/leg-manager-auth";
import { issueOfficeToken } from "@/features/office/office-auth";
import { createRequireOwnerMiddleware } from "./owner-middleware";
import { issueOwnerToken } from "./owner-token";

const ownerId = "30000000-0000-4000-8000-000000000001";
const owner = {
  id: ownerId,
  loginName: "desiree",
  displayName: "Desiree",
  role: "owner" as const,
  enabled: true,
  sessionVersion: 4,
};

function app(getActiveSession: ReturnType<typeof vi.fn>) {
  const instance = express();
  instance.get(
    "/owner-only",
    createRequireOwnerMiddleware({ getActiveSession }),
    (req, res) => {
      res.json({ userId: (req as any).userId, owner: (req as any).ownerAccount });
    },
  );
  return instance;
}

beforeEach(() => {
  process.env.SESSION_SECRET = "owner-middleware-test-secret";
});

describe("owner middleware", () => {
  it("accepts only a live database session for the signed owner", async () => {
    const getActiveSession = vi.fn().mockResolvedValue(owner);
    const token = issueOwnerToken({ ownerId, sessionVersion: 4 })!.token;

    const response = await request(app(getActiveSession))
      .get("/owner-only")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(getActiveSession).toHaveBeenCalledWith(ownerId);
    expect(response.body).toEqual({
      userId: ownerId,
      owner: { accountId: ownerId, displayName: "Desiree", role: "owner" },
    });
  });

  it("rejects a token after the account session version changes", async () => {
    const getActiveSession = vi.fn().mockResolvedValue({ ...owner, sessionVersion: 5 });
    const token = issueOwnerToken({ ownerId, sessionVersion: 4 })!.token;

    expect(
      (await request(app(getActiveSession)).get("/owner-only").set("Authorization", `Bearer ${token}`)).status,
    ).toBe(401);
  });

  it("rejects missing, disabled, Office, and leg-manager credentials", async () => {
    const getActiveSession = vi.fn().mockResolvedValue(null);
    const instance = app(getActiveSession);
    const office = issueOfficeToken({
      accountId: "10000000-0000-4000-8000-000000000001",
      sessionVersion: 1,
    })!;
    const manager = issueLegManagerToken({
      legId: "20000000-0000-4000-8000-000000000001",
      sessionVersion: 1,
    })!;

    expect((await request(instance).get("/owner-only")).status).toBe(401);
    expect(
      (await request(instance).get("/owner-only").set("Authorization", `Bearer ${office.token}`)).status,
    ).toBe(401);
    expect(
      (await request(instance).get("/owner-only").set("Authorization", `Bearer ${manager.token}`)).status,
    ).toBe(401);
    expect(getActiveSession).not.toHaveBeenCalled();
  });
});
