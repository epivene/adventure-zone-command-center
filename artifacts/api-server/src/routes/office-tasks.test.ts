import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  listForOffice: vi.fn(),
  updateForOffice: vi.fn(),
  todayForOffice: vi.fn(),
  verifyOfficeToken: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/office/office-account-repository", () => ({
  DrizzleOfficeAccountRepository: class { getActiveSession = mocks.getActiveSession; },
}));
vi.mock("@/features/office/office-task-repository", () => ({
  DrizzleOfficeTaskRepository: class {
    listForOffice = mocks.listForOffice;
    updateForOffice = mocks.updateForOffice;
    todayForOffice = mocks.todayForOffice;
  },
}));
vi.mock("@/features/office/office-email-repository", () => ({ DrizzleOfficeEmailRepository: class { listNeedsChanges = vi.fn().mockResolvedValue([]); } }));
vi.mock("@/features/office/office-message-repository", () => ({ DrizzleOfficeMessageRepository: class { unreadCount = vi.fn().mockResolvedValue(0); } }));
vi.mock("@/features/office/office-auth", () => ({ verifyOfficeToken: mocks.verifyOfficeToken }));

import router from "./office-tasks";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(router);
  return instance;
}

const accountId = "10000000-0000-4000-8000-000000000001";
const taskId = "20000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyOfficeToken.mockReturnValue({ accountId, sessionVersion: 1, expiresAtMs: Date.now() + 10000 });
  mocks.getActiveSession.mockResolvedValue({ id: accountId, displayName: "Amy", role: "office_coordinator", enabled: true, sessionVersion: 1 });
  mocks.listForOffice.mockResolvedValue([]);
  mocks.todayForOffice.mockResolvedValue({ tasks: [], activeCount: 0, needsHelpCount: 0 });
  mocks.updateForOffice.mockResolvedValue({ id: taskId, status: "in_progress" });
});

describe("office task routes", () => {
  it("allows only task-progress fields", async () => {
    const response = await request(app())
      .patch(`/office/tasks/${taskId}`)
      .set("Authorization", "Bearer office-token")
      .send({ status: "in_progress", coordinatorNote: "Called the office", needsHelp: false });
    expect(response.status).toBe(200);
    expect(mocks.updateForOffice).toHaveBeenCalledWith(taskId, accountId, expect.objectContaining({ status: "in_progress" }));
  });

  it("requires brochure tasks to complete through the mailed workflow", async () => {
    mocks.listForOffice.mockResolvedValue([{ id: taskId, type: "mail_brochure", status: "in_progress" }]);
    const response = await request(app())
      .patch(`/office/tasks/${taskId}`)
      .set("Authorization", "Bearer office-token")
      .send({ status: "done" });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/mailed/i);
    expect(mocks.updateForOffice).not.toHaveBeenCalled();
  });

  it.each(["ownerSortOrder", "officeAccountId", "organizationId", "taskType"])("rejects crafted %s changes", async (field) => {
    const response = await request(app())
      .patch(`/office/tasks/${taskId}`)
      .set("Authorization", "Bearer office-token")
      .send({ [field]: field === "ownerSortOrder" ? 0 : "forbidden" });
    expect(response.status).toBe(400);
    expect(mocks.updateForOffice).not.toHaveBeenCalled();
  });
});
