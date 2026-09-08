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
      actor: req.officeAccount?.accountId ?? null,
    }));
    return router;
  },
}));

vi.mock("@/features/office/office-account-repository", () => ({
  DrizzleOfficeAccountRepository: class { getActiveSession = mocks.getActiveSession; },
}));
vi.mock("@/features/office/office-auth", () => ({ verifyOfficeToken: mocks.verifyToken }));

import router from "./office-documents";

function app() {
  const instance = express();
  instance.use(router);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyToken.mockReturnValue({ accountId: "amy", sessionVersion: 1, expiresAtMs: Date.now() + 10_000 });
  mocks.getActiveSession.mockResolvedValue({
    id: "amy",
    displayName: "Amy",
    role: "office_coordinator",
    enabled: true,
    sessionVersion: 1,
    canReviewWebsiteInquiries: false,
  });
});

describe("Office business document authorization", () => {
  it("rejects unauthenticated full-library access", async () => {
    await request(app()).get("/office/business-documents").expect(401);
  });

  it("rejects a session that is not an Office Coordinator", async () => {
    mocks.getActiveSession.mockResolvedValue({ id: "amy", displayName: "Amy", role: "boss", enabled: true, sessionVersion: 1 });
    await request(app()).get("/office/business-documents").set("Authorization", "Bearer office-token").expect(401);
  });

  it("allows Amy through the Office wrapper", async () => {
    const response = await request(app()).get("/office/business-documents").set("Authorization", "Bearer office-token").expect(200);
    expect(response.body).toEqual({ actor: "amy" });
  });
});
