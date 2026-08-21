import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAdmin: vi.fn(),
  list: vi.fn(),
  unreadCount: vi.fn(),
  send: vi.fn(),
  markRead: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/office/office-account-repository", () => ({
  DrizzleOfficeAccountRepository: class { listAdmin = mocks.listAdmin; },
}));
vi.mock("@/features/office/office-message-repository", () => ({
  DrizzleOfficeMessageRepository: class {
    list = mocks.list;
    unreadCount = mocks.unreadCount;
    send = mocks.send;
    markRead = mocks.markRead;
  },
}));

import router from "./office-admin-messages";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(router);
  return instance;
}

const accountId = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAdmin.mockResolvedValue([{ id: accountId, displayName: "Amy", loginName: "amy", role: "office_coordinator", enabled: false, sessionVersion: 2 }]);
  mocks.list.mockResolvedValue([{ id: "m1", officeAccountId: accountId, actorKind: "office", body: "Old message" }]);
  mocks.unreadCount.mockResolvedValue(1);
  mocks.send.mockResolvedValue({ id: "m2", officeAccountId: accountId, actorKind: "owner", body: "Follow-up note" });
  mocks.markRead.mockResolvedValue(undefined);
});

describe("owner office message routes", () => {
  it("keeps a disabled account's historical thread available to owner", async () => {
    const response = await request(app()).get(`/office-admin/messages/${accountId}`);
    expect(response.status).toBe(200);
    expect(response.body.messages).toHaveLength(1);
    expect(mocks.list).toHaveBeenCalledWith(accountId);
  });

  it("still allows owner to add a message to an existing disabled account thread", async () => {
    const response = await request(app()).post(`/office-admin/messages/${accountId}`).send({ body: "Follow-up note" });
    expect(response.status).toBe(201);
    expect(mocks.send).toHaveBeenCalledWith(accountId, "owner", "Follow-up note");
  });
});
