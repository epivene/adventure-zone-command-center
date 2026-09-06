import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listForOwner: vi.fn(),
  createForOwner: vi.fn(),
  updateForOwner: vi.fn(),
  deleteForOwner: vi.fn(),
  reorderForOwner: vi.fn(),
  dbSelect: vi.fn(),
  dbFrom: vi.fn(),
  dbWhere: vi.fn(),
  dbLimit: vi.fn(),
}));

mocks.dbSelect.mockImplementation(() => ({ from: mocks.dbFrom }));
mocks.dbFrom.mockImplementation(() => ({ where: mocks.dbWhere }));
mocks.dbWhere.mockImplementation(() => ({ limit: mocks.dbLimit }));

vi.mock("@workspace/db", () => ({ db: { select: mocks.dbSelect } }));
vi.mock("@/features/office/office-task-repository", () => ({
  DrizzleOfficeTaskRepository: class {
    listForOwner = mocks.listForOwner;
    createForOwner = mocks.createForOwner;
    updateForOwner = mocks.updateForOwner;
    deleteForOwner = mocks.deleteForOwner;
    reorderForOwner = mocks.reorderForOwner;
  },
}));

import router from "./office-admin-tasks";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(router);
  return instance;
}

const accountId = "10000000-0000-4000-8000-000000000001";
const taskId = "20000000-0000-4000-8000-000000000001";
const organizationId = "30000000-0000-4000-8000-000000000001";
const contactId = "40000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dbSelect.mockImplementation(() => ({ from: mocks.dbFrom }));
  mocks.dbFrom.mockImplementation(() => ({ where: mocks.dbWhere }));
  mocks.dbWhere.mockImplementation(() => ({ limit: mocks.dbLimit }));
  mocks.dbLimit.mockResolvedValue([{ id: "relationship-1" }]);
  mocks.listForOwner.mockResolvedValue([]);
  mocks.createForOwner.mockResolvedValue({ id: taskId });
  mocks.updateForOwner.mockResolvedValue({ id: taskId });
  mocks.deleteForOwner.mockResolvedValue({ id: taskId });
  mocks.reorderForOwner.mockResolvedValue(true);
});

describe("owner office task routes", () => {
  it("creates a linked task for a selected Office Coordinator", async () => {
    const response = await request(app()).post("/office-admin/tasks").send({
      officeAccountId: accountId,
      taskType: "contact_verification",
      title: "Verify contact",
      instructions: "Check phone and email",
      organizationId: null,
      contactId: null,
      dueAt: null,
    });
    expect(response.status).toBe(201);
    expect(mocks.createForOwner).toHaveBeenCalledWith(expect.objectContaining({ officeAccountId: accountId }));
  });

  it("accepts a contact that belongs to the selected profile", async () => {
    const response = await request(app()).post("/office-admin/tasks").send({
      officeAccountId: accountId,
      taskType: "contact_verification",
      title: "Verify Jane",
      organizationId,
      contactId,
      dueAt: null,
    });
    expect(response.status).toBe(201);
    expect(mocks.createForOwner).toHaveBeenCalledWith(expect.objectContaining({ organizationId, contactId }));
  });

  it("rejects a contact that is not part of the selected profile", async () => {
    mocks.dbLimit.mockResolvedValueOnce([]);
    const response = await request(app()).post("/office-admin/tasks").send({
      officeAccountId: accountId,
      taskType: "contact_verification",
      title: "Verify Jane",
      organizationId,
      contactId,
      dueAt: null,
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/not part of/i);
    expect(mocks.createForOwner).not.toHaveBeenCalled();
  });

  it("passes an explicit ordered task list to the atomic reorder operation", async () => {
    const response = await request(app()).post("/office-admin/tasks/reorder").send({
      accountId,
      taskIds: [taskId, "20000000-0000-4000-8000-000000000002"],
    });
    expect(response.status).toBe(200);
    expect(mocks.reorderForOwner).toHaveBeenCalledWith(accountId, [taskId, "20000000-0000-4000-8000-000000000002"]);
  });

  it("lets the owner permanently remove a task", async () => {
    const response = await request(app()).delete(`/office-admin/tasks/${taskId}`);
    expect(response.status).toBe(200);
    expect(mocks.deleteForOwner).toHaveBeenCalledWith(taskId);
  });
});
