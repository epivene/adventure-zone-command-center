import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  verifyOfficeToken: vi.fn(),
  listForOffice: vi.fn(),
  markPrepared: vi.fn(),
  markMailed: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/office/office-account-repository", () => ({ DrizzleOfficeAccountRepository: class { getActiveSession = mocks.getActiveSession; } }));
vi.mock("@/features/office/office-auth", () => ({ verifyOfficeToken: mocks.verifyOfficeToken }));
vi.mock("@/features/office/office-mail-repository", () => ({ DrizzleOfficeMailRepository: class { listForOffice = mocks.listForOffice; } }));
vi.mock("@/features/office/office-mail-service", async () => {
  const actual = await vi.importActual<any>("@/features/office/office-mail-service");
  return { ...actual, OfficeMailService: class { markPrepared = mocks.markPrepared; markMailed = mocks.markMailed; } };
});

import router from "./office-mail";

function app() { const instance = express(); instance.use(express.json()); instance.use(router); return instance; }
const accountId = "10000000-0000-4000-8000-000000000001";
const taskId = "20000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyOfficeToken.mockReturnValue({ accountId, sessionVersion: 1, expiresAtMs: Date.now() + 10000 });
  mocks.getActiveSession.mockResolvedValue({ id: accountId, displayName: "Amy", role: "office_coordinator", enabled: true, sessionVersion: 1 });
  mocks.listForOffice.mockResolvedValue([]);
  mocks.markPrepared.mockResolvedValue({ id: "mail-1" });
  mocks.markMailed.mockResolvedValue({ id: "mail-1", mailedAt: new Date() });
});

describe("office mail routes", () => {
  it("snapshots verified recipient/address on Prepared", async () => {
    const response = await request(app()).post(`/office/mail/${taskId}/prepared`).set("Authorization", "Bearer office-token").send({ recipientName: "Fair Office", address1: "1 Main", address2: null, city: "Example", region: "ND", postalCode: "58000" });
    expect(response.status).toBe(200);
    expect(mocks.markPrepared).toHaveBeenCalledWith(expect.objectContaining({ accountId, taskId, recipientName: "Fair Office" }));
  });

  it("records mailed date and bounded note", async () => {
    const response = await request(app()).post(`/office/mail/${taskId}/mailed`).set("Authorization", "Bearer office-token").send({ mailedAt: "2026-08-21T18:00:00.000Z", note: "Tracking 123" });
    expect(response.status).toBe(200);
    expect(mocks.markMailed).toHaveBeenCalledWith(expect.objectContaining({ accountId, taskId, note: "Tracking 123" }));
  });
});
