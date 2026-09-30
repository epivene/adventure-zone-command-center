import { it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createChatGPTMcpRouter } from "../../routes/chatgpt-mcp";
import { connectionScopes } from "./contracts";
const resource = "https://app.example/api/chatgpt/mcp";
function setup(scopes = connectionScopes, enabled = true) {
  const search = vi.fn(async () => ({
    items: [],
    nextCursor: null,
    truncated: false,
  }));
  const services = {
    reads: { search },
    notes: {},
    updates: {},
    drafts: {},
    operations: {},
  } as any;
  const app = express();
  app.use(
    "/api/chatgpt/mcp",
    createChatGPTMcpRouter({
      enabled,
      resource,
      allowedOrigins: ["https://app.example"],
      db: { query: async () => ({ rows: [{ calls: 1 }] }) },
      verify: async (token) => {
        if (token !== "good") throw Error("bad");
        return {
          ownerId: "owner",
          connectionId: randomUUID(),
          clientId: "client",
          scopes,
        };
      },
      services,
    }),
  );
  return { app, search };
}
function rpc(app: any, method: string, params: any = {}, token = "good") {
  return request(app)
    .post("/api/chatgpt/mcp")
    .set("Host", "app.example")
    .set("Accept", "application/json, text/event-stream")
    .auth(token, { type: "bearer" })
    .send({ jsonrpc: "2.0", id: 1, method, params });
}
it("discovers the exact tool set and calls a scoped read over Streamable HTTP", async () => {
  const { app, search } = setup();
  const list = await rpc(app, "tools/list");
  expect(list.status, list.text).toBe(200);
  expect(list.body.result.tools.map((t: any) => t.name).sort()).toEqual(
    [
      "search_profiles",
      "read_profile_context",
      "read_saved_document",
      "create_researched_lead",
      "append_research_note",
      "propose_profile_update",
      "apply_approved_profile_update",
      "save_app_draft",
      "list_followups",
      "save_followup",
      "get_operation_receipt",
    ].sort(),
  );
  const call = await rpc(app, "tools/call", {
    name: "search_profiles",
    arguments: { query: "Fair", eventYear: 2027 },
  });
  expect(call.status, call.text).toBe(200);
  expect(search).toHaveBeenCalledOnce();
});
it("hides and blocks ungranted writes and rejects auth, host, origin, disabled flag and oversized bodies", async () => {
  const { app } = setup(["crm:read"]);
  const list = await rpc(app, "tools/list");
  expect(list.body.result.tools.map((t: any) => t.name)).not.toContain(
    "save_app_draft",
  );
  const write = await rpc(app, "tools/call", {
    name: "append_research_note",
    arguments: {},
  });
  expect(write.body.error ?? write.body.result?.isError).toBeTruthy();
  expect((await rpc(app, "tools/list", {}, "bad")).status).toBe(401);
  expect(
    (await rpc(app, "tools/list").set("Host", "evil.example")).status,
  ).toBe(403);
  expect(
    (await rpc(app, "tools/list").set("Origin", "https://evil.example")).status,
  ).toBe(403);
  expect(
    (await rpc(setup(connectionScopes, false).app, "tools/list")).status,
  ).toBe(503);
  expect(
    (await rpc(app, "tools/call", { padding: "x".repeat(300000) })).status,
  ).toBe(413);
});
