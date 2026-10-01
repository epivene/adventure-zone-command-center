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
      "preview_email_profile_assignment",
      "apply_email_profile_assignment",
      "read_email_profile_assignment",
      "read_leg_schedule",
      "read_route_plan",
      "read_operational_resources",
      "list_booking_work", "read_booking_work", "claim_booking_work", "update_booking_work", "release_booking_work", "claim_existing_booking_work",
      "search_profiles",
      "read_profile_context",
      "read_saved_document",
      "create_researched_lead",
      "append_research_note",
      "propose_profile_update",
      "preview_profile_merge",
      "apply_approved_profile_merge",
      "apply_approved_profile_update",
      "list_app_drafts",
      "read_app_draft",
      "save_app_draft",
      "list_followups",
      "save_followup",
      "complete_followup",
      "dismiss_followup",
      "get_operation_receipt",
      "request_write_access",
      "request_edit_access",
      "request_email_organize_access",
      "read_profile_note",
      "edit_profile_note",
    ].sort(),
  );
  const call = await rpc(app, "tools/call", {
    name: "search_profiles",
    arguments: { query: "Fair", eventYear: 2027 },
  });
  expect(call.status, call.text).toBe(200);
  expect(search).toHaveBeenCalledOnce();
});
it("lets a read-only connection request owner consent without performing a write", async () => {
  const { app } = setup(["crm:read"]);
  const list = await rpc(app, "tools/list");
  const tool = list.body.result.tools.find(
    (t: any) => t.name === "request_write_access",
  );
  expect(tool).toBeDefined();
  expect(tool._meta.securitySchemes).toEqual([
    {
      type: "oauth2",
      scopes: ["crm:read", "crm:append", "drafts:write", "followups:write"],
    },
  ]);
  const result = await rpc(app, "tools/call", {
    name: "request_write_access",
    arguments: {},
  });
  expect(result.body.result.isError).toBe(true);
  const challenge = result.body.result._meta["mcp/www_authenticate"][0];
  expect(challenge).toContain('error="insufficient_scope"');
  expect(challenge).toContain(
    'scope="crm:read crm:append drafts:write followups:write"',
  );
  expect(challenge).toContain(
    'resource_metadata="https://app.example/.well-known/oauth-protected-resource/api/chatgpt/mcp"',
  );
  // setup provides no write-service methods: this must succeed without invoking them.
  expect(
    (await rpc(app, "tools/list")).body.result.tools.map((t: any) => t.name),
  ).toContain("create_researched_lead");
});
it("reports existing write permission without starting another authorization", async () => {
  const { app } = setup();
  const result = await rpc(app, "tools/call", {
    name: "request_write_access",
    arguments: {},
  });
  expect(result.body.result.isError).not.toBe(true);
  expect(result.body.result._meta?.["mcp/www_authenticate"]).toBeUndefined();
  expect(JSON.parse(result.body.result.content[0].text).status).toBe(
    "authorized",
  );
});
it("advertises and blocks ungranted writes and rejects auth, host, origin, disabled flag and oversized bodies", async () => {
  const { app } = setup(["crm:read"]);
  const list = await rpc(app, "tools/list");
  expect(list.body.result.tools.map((t: any) => t.name)).toContain(
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

it("requests separate edit consent without broadening the existing append grant", async () => {
  const { app } = setup(["crm:read", "crm:append"]);
  const list = await rpc(app, "tools/list");
  const names = list.body.result.tools.map((t: any) => t.name);
  expect(names).toContain("read_profile_note"); expect(names).toContain("edit_profile_note");
  const result = await rpc(app, "tools/call", { name: "request_edit_access", arguments: {} });
  expect(result.body.result.isError).toBe(true);
  expect(result.body.result._meta["mcp/www_authenticate"][0]).toContain('scope="crm:read crm:append crm:update"');
  expect((await rpc(app, "tools/list")).body.result.tools.map((t: any) => t.name)).toContain("edit_profile_note");
});

it("keeps discovery identical across read, append and full grants", async () => {
  const full = (await rpc(setup().app, "tools/list")).body.result.tools;
  for (const scopes of [["crm:read"], ["crm:read", "crm:append"]] as const) {
    const list = await rpc(setup([...scopes]).app, "tools/list");
    expect(list.body.result.tools).toEqual(full);
  }
  const edit = full.find((t: any) => t.name === "edit_profile_note");
  expect(edit.annotations.destructiveHint).toBe(true);
  expect(edit._meta.securitySchemes).toEqual([{ type: "oauth2", scopes: ["crm:update"] }]);
});
it("challenges an ungranted edit before invoking any note service", async () => {
  const { app } = setup(["crm:read", "crm:append"]);
  const result = await rpc(app, "tools/call", {
    name: "edit_profile_note",
    arguments: { requestKey: "denied-edit", profileId: randomUUID(), noteId: randomUUID(),
      expectedRevision: "revision", body: "Short note", reason: "Owner requested cleanup" },
  });
  expect(result.body.result?.isError).toBe(true);
  expect(JSON.parse(result.body.result.content[0].text).code).toBe("CONNECTION_ACCESS_DENIED");
  expect(result.body.result._meta["mcp/www_authenticate"][0]).toContain('scope="crm:read crm:append crm:update"');
  // No note methods exist in setup: falling through to a service cannot pass.
});
it("advertises merge tools but blocks an ungranted merge before service access",async()=>{
  const {app}=setup(["crm:read"]);
  const result=await rpc(app,"tools/call",{name:"apply_approved_profile_merge",arguments:{requestKey:"denied",proposalId:randomUUID(),approvalId:randomUUID()}});
  expect(result.body.result.isError).toBe(true);
  expect(JSON.parse(result.body.result.content[0].text).code).toBe("CONNECTION_ACCESS_DENIED");
});
it("requests email organization separately and retains existing grants", async () => {
 const { app } = setup(["crm:read","crm:update","followups:write"]);
 const result = await rpc(app,"tools/call",{name:"request_email_organize_access",arguments:{}});
 expect(result.body.result.isError).toBe(true);
 expect(result.body.result._meta["mcp/www_authenticate"][0]).toContain('scope="crm:read crm:update followups:write email:organize"');
});
it("denies email filing to a CRM-edit-only connection before calling services",async()=>{
 const {app}=setup(["crm:read","crm:update"]);
 const r=await rpc(app,"tools/call",{name:"apply_email_profile_assignment",arguments:{previewId:randomUUID(),expectedRevision:null,requestKey:"filing"}});
 expect(r.body.result.isError).toBe(true);
 expect(r.body.result._meta["mcp/www_authenticate"][0]).toContain("email:organize");
});
