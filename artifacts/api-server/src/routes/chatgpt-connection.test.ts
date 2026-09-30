import { beforeEach, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { issueToken } from "../lib/auth";
import { createChatGPTConnectionRouter } from "./chatgpt-connection";
let app: ReturnType<typeof express>,
  token: string,
  registerClient: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.OWNER_PASSWORD = "test";
  process.env.SESSION_SECRET = "session-secret";
  token = issueToken()!.token;
  registerClient = vi.fn(async () => ({ clientId: "new" }));
  app = express();
  app.use(express.json());
  app.use(
    "/api/chatgpt-connection",
    createChatGPTConnectionRouter({
      enabled: true,
      appOrigin: "https://app.example",
      resource: "https://app.example/api/chatgpt/mcp",
      db: { query: async () => ({ rows: [] }) },
      oauth: { store: { registerClient } } as any,
    }),
  );
});
it("requires owner login and a session-bound CSRF token on exact-origin writes", async () => {
  expect((await request(app).get("/api/chatgpt-connection")).status).toBe(401);
  const status = await request(app)
    .get("/api/chatgpt-connection")
    .auth(token, { type: "bearer" });
  expect(status.status).toBe(200);
  expect(status.body.csrfToken).toBeTruthy();
  const write = () =>
    request(app)
      .post("/api/chatgpt-connection/clients")
      .auth(token, { type: "bearer" })
      .set("Origin", "https://app.example");
  expect((await write().send({ name: "x", redirectUris: [] })).status).toBe(
    403,
  );
  expect(
    (
      await write()
        .set("X-Connection-CSRF", status.body.csrfToken)
        .send({ name: "x", redirectUris: [] })
    ).status,
  ).toBe(201);
  expect(registerClient).toHaveBeenCalledWith("owner", {
    name: "x",
    redirectUris: [],
  });
  expect(
    (
      await request(app)
        .post("/api/chatgpt-connection/clients")
        .auth(token, { type: "bearer" })
        .set("Origin", "https://evil.example")
        .set("X-Connection-CSRF", status.body.csrfToken)
        .send({})
    ).status,
  ).toBe(403);
});
