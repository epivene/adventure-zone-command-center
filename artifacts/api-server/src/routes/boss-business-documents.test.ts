import express, { Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  getActiveSession: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("./business-documents", () => ({
  createBusinessDocumentsRouter: () => {
    const router = Router();
    router.get("/business-documents", (req, res) => res.json({
      actor: req.bossAccount?.accountId ?? null,
    }));
    return router;
  },
}));

vi.mock("@/features/boss/boss-account-repository", () => ({
  DrizzleBossAccountRepository: class { getActiveSession = mocks.getActiveSession; },
}));
vi.mock("@/features/boss/boss-auth", () => ({ verifyBossToken: mocks.verifyToken }));

import router from "./boss-business-documents";

function app() {
  const instance = express();
  instance.use(router);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyToken.mockReturnValue({ accountId: "dave", sessionVersion: 1, expiresAtMs: Date.now() + 10_000 });
  mocks.getActiveSession.mockResolvedValue({
    id: "dave",
    displayName: "Dave",
    role: "boss",
    enabled: true,
    sessionVersion: 1,
    studioOfficeAccountId: null,
  });
});

describe("Boss business document authorization", () => {
  it("rejects unauthenticated full-library access", async () => {
    await request(app()).get("/boss/business-documents").expect(401);
  });

  it("rejects a session that is not Boss", async () => {
    mocks.getActiveSession.mockResolvedValue({ id: "dave", displayName: "Dave", role: "office_coordinator", enabled: true, sessionVersion: 1 });
    await request(app()).get("/boss/business-documents").set("Authorization", "Bearer boss-token").expect(401);
  });

  it("allows Dave through the Boss wrapper", async () => {
    const response = await request(app()).get("/boss/business-documents").set("Authorization", "Bearer boss-token").expect(200);
    expect(response.body).toEqual({ actor: "dave" });
  });
});
