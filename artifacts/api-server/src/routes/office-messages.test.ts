import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  verifyOfficeToken: vi.fn(),
  list: vi.fn(),
  unreadCount: vi.fn(),
  send: vi.fn(),
  markRead: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/office/office-account-repository", () => ({ DrizzleOfficeAccountRepository: class { getActiveSession = mocks.getActiveSession; } }));
vi.mock("@/features/office/office-auth", () => ({ verifyOfficeToken: mocks.verifyOfficeToken }));
vi.mock("@/features/office/office-message-repository", () => ({ DrizzleOfficeMessageRepository: class { list=mocks.list; unreadCount=mocks.unreadCount; send=mocks.send; markRead=mocks.markRead; } }));

import router from "./office-messages";
function app(){const x=express();x.use(express.json());x.use(router);return x;}
const accountId="10000000-0000-4000-8000-000000000001";
beforeEach(()=>{vi.clearAllMocks();mocks.verifyOfficeToken.mockReturnValue({accountId,sessionVersion:1,expiresAtMs:Date.now()+10000});mocks.getActiveSession.mockResolvedValue({id:accountId,displayName:"Amy",role:"office_coordinator",enabled:true,sessionVersion:1});mocks.list.mockResolvedValue([]);mocks.unreadCount.mockResolvedValue(0);mocks.send.mockResolvedValue({id:"m1"});});

describe("Office messages",()=>{
  it("always scopes thread reads to the authenticated Office account",async()=>{const r=await request(app()).get("/office/messages").set("Authorization","Bearer office-token");expect(r.status).toBe(200);expect(mocks.list).toHaveBeenCalledWith(accountId);expect(mocks.unreadCount).toHaveBeenCalledWith(accountId,"office");});
  it("sends only as the authenticated Office account",async()=>{const r=await request(app()).post("/office/messages").set("Authorization","Bearer office-token").send({body:"Need help finding the current contact."});expect(r.status).toBe(201);expect(mocks.send).toHaveBeenCalledWith(accountId,"office","Need help finding the current contact.");});
});
