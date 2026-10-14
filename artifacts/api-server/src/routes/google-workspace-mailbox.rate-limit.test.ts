import express from "express";
import request from "supertest";
import { expect, it, vi } from "vitest";
vi.mock("../lib/auth", () => ({ requireOwnerMiddleware: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("@/features/google-workspace/google-mailbox-service", () => ({ GoogleMailboxService: class {} }));
import { createGoogleMailboxRouter } from "./google-workspace-mailbox";
it("returns Gmail's cooldown as 429 with Retry-After", async () => {
  const service = { list: vi.fn().mockRejectedValue(Object.assign(new Error("GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED"), { retryAfterSeconds: 123 })) };
  const app = express().use(createGoogleMailboxRouter(service as any));
  const response = await request(app).get("/google-workspace/mailbox");
  expect(response.status).toBe(429);
  expect(response.headers["retry-after"]).toBe("123");
  expect(response.body.retryAfterSeconds).toBe(123);
});
it("keeps reauthorization distinct and defaults a missing cooldown to 60 seconds", async () => {
  const service = { list: vi.fn().mockRejectedValueOnce(new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED")).mockRejectedValueOnce(new Error("GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED")) };
  const app = express().use(createGoogleMailboxRouter(service as any));
  expect((await request(app).get("/google-workspace/mailbox")).status).toBe(409);
  const limited = await request(app).get("/google-workspace/mailbox");
  expect(limited.status).toBe(429);
  expect(limited.headers["retry-after"]).toBe("60");
});
