import { EmailThreadAttentionService } from "../google-workspace/email-thread-attention-service";
import { ensureEmailThreadAttentionSchema } from "../../db/email-thread-attention-schema";
import { BookingWorkService } from "../booking-work/service";
import { ProfileMergeService } from "./profile-merge-service";
import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { fixture } from "./test-database";
import { ConnectionReadService } from "./read-service";
import { LeadNoteService } from "./lead-note-service";
import { ProfileUpdateService } from "./profile-update-service";
import { DraftFollowupService } from "./draft-followup-service";
import { OperationStore } from "./operation-store";
import { createChatGPTMcpRouter, connectionRequestsPerMinute } from "../../routes/chatgpt-mcp";
import { createChatGPTConnectionRouter } from "../../routes/chatgpt-connection";
import { issueToken } from "../../lib/auth";
import { profileRow } from "./read-service";
vi.mock("../assistant-workspace/model-provider", () => {
  throw Error("Paid provider imported");
});
vi.mock("../assistant-workspace/run-store", () => {
  throw Error("RunStore imported");
});
vi.mock("../assistant-workspace/document-extraction-store", () => {
  throw Error("Extraction imported");
});
it("reads and saves through MCP, replays once, reloads owner drafts, and refuses revoked access with AI off", async () => {
  process.env.ASSISTANT_WORKSPACE_ENABLED = "false";
  delete process.env.OPENAI_API_KEY;
  process.env.OWNER_PASSWORD = "test";
  process.env.SESSION_SECRET = "integration-secret";
  const f = await fixture();
  try {
    await ensureEmailThreadAttentionSchema(f.db);
    await f.db.query("CREATE TABLE google_workspace_validation_mappings(connection_id uuid,thread_id text,organization_id uuid)");
    const attentionAccount=randomUUID();
    const attention=new EmailThreadAttentionService(f.db,{
      authorize:async()=>{},
      source:async()=>({gmailConnectionId:attentionAccount,threadId:"attention-thread",latestMessageId:"attention-message",sourceFingerprint:"v1",subject:"Fair question",from:"fair@example.com",to:"office@example.com",internalDateMs:1,hasAttachments:false}),
      assign:async()=>({mutation:{id:"attention-mutation"}} as any),
      sync:async()=>({gmailSync:{state:"completed",errorCode:null},archiveSync:{state:"complete",conversationId:"saved-thread",errorCode:null}}),
    });
    const services = {
      attention,
      work: new BookingWorkService(f.db),
      reads: new ConnectionReadService(f.db),
      notes: new LeadNoteService(f.db),
      updates: new ProfileUpdateService(f.db),
      merges: new ProfileMergeService(f.db),
      drafts: new DraftFollowupService(f.db),
      operations: new OperationStore(f.db),
    };
    const app = express();
    app.use(
      "/api/chatgpt/mcp",
      createChatGPTMcpRouter({
        enabled: true,
        resource: "https://app.example/api/chatgpt/mcp",
        allowedOrigins: ["https://app.example"],
        db: f.db,
        verify: async (t) => {
          if (t !== "test-connection") throw Error();
          return f.principal;
        },
        services,
      }),
    );
    app.use(
      "/api/chatgpt-connection",
      express.json(),
      createChatGPTConnectionRouter({
        enabled: true,
        resource: "https://app.example/api/chatgpt/mcp",
        appOrigin: "https://app.example",
        db: f.db,
      }),
    );
    async function call(name: string, args: any) {
      const response = await request(app)
        .post("/api/chatgpt/mcp")
        .set("Host", "app.example")
        .set("Accept", "application/json, text/event-stream")
        .auth("test-connection", { type: "bearer" })
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        });
      expect(response.status, response.text).toBe(200);
      if (response.body.result?.isError)
        throw Error(response.body.result.content[0].text);
      return JSON.parse(response.body.result.content[0].text);
    }
    expect(
      (await call("search_profiles", { query: "County", eventYear: 2027 }))
        .items[0].id,
    ).toBe(f.profileId);
    await call("read_profile_context", {
      profileId: f.profileId,
      eventYear: 2027,
    });
    const preview = await call("preview_email_profile_assignment", {messageId:"attention-message",profileId:f.profileId,eventYear:null,state:"needs_your_reply",reason:"Question awaiting reply"});
    const filing={previewId:preview.id,expectedRevision:preview.expectedRevision,requestKey:"attention-save"};
    const filed=await call("apply_email_profile_assignment",filing);
    expect(filed.record.state).toBe("needs_your_reply");
    expect(await call("get_operation_receipt",{operationId:filed.operationId})).toEqual(filed);
    expect(await call("apply_email_profile_assignment",filing)).toEqual(filed);
    expect((await call("read_email_profile_assignment",{gmailConnectionId:attentionAccount,threadId:"attention-thread"})).operationId).toBe(filed.operationId);
    const sources = [
      {
        url: "https://fair.example",
        retrievedAt: "2026-09-30T00:00:00Z",
        eventYear: 2027,
        claim: "Public listing, role not verified",
        verification: "unverified",
      },
    ];
    const operations = [
      [
        "append_research_note",
        {
          requestKey: "note",
          profileId: f.profileId,
          subject: "Research",
          body: "Unverified contact",
          sources,
        },
      ],
      [
        "save_app_draft",
        {
          requestKey: "draft",
          content: {
            organizationId: f.profileId,
            to: ["office@fair.example"],
            cc: [],
            subject: "Question",
            html: "<p>Hello</p>",
            text: "Hello",
            threadId: null,
            attachmentIds: [],
            attachmentHashes: [],
            templateId: null,
            templateVersion: null,
          },
        },
      ],
      [
        "save_followup",
        {
          requestKey: "followup",
          profileId: f.profileId,
          contactId: null,
          bookingId: null,
          kind: "call",
          dueAt: "2026-10-05T18:00:00Z",
        },
      ],
    ] as const;
    for (const [name, input] of operations) {
      const saved = await call(name, input);
      expect(await call(name, input)).toEqual(saved);
      expect(
        await call("get_operation_receipt", { operationId: saved.operationId }),
      ).toEqual(saved);
    }
    const lead = await call("create_researched_lead", {
      requestKey: "lead",
      name: "Different Fair",
      city: "Elsewhere",
      region: "UT",
      officialWebsite: "https://different.example",
      sourceIdentity: null,
      eventYear: 2027,
      sources,
    });
    expect(lead.recordId).not.toBe(f.profileId);
    expect(
      (await call("list_followups", { profileId: f.profileId })).items,
    ).toHaveLength(1);
    const proposal = await call("propose_profile_update", {
      requestKey: "proposal",
      profileId: f.profileId,
      expectedRevision: (await profileRow(f.db, f.profileId)).revision,
      values: { city: "New Town" },
      sources,
    });
    const approval = await services.updates.approve(
      "owner",
      proposal.recordId,
      proposal.value.contentHash,
    );
    await call("apply_approved_profile_update", {
      requestKey: "apply",
      proposalId: proposal.recordId,
      approvalId: approval.approvalId,
    });
    const owner = issueToken()!.token;
    const drafts = await request(app)
      .get("/api/chatgpt-connection/drafts")
      .auth(owner, { type: "bearer" });
    expect(drafts.body.items).toHaveLength(1);
    expect(drafts.body.items[0].content.text).toBe("Hello");
    expect((await f.db.query("SELECT * FROM follow_ups")).rows).toHaveLength(1);
    const existingReminder = (await call("list_followups", {profileId:f.profileId})).items[0];
    const savedDraftPage = await call("list_app_drafts", { profileId: f.profileId });
    expect(savedDraftPage.items).toHaveLength(1);
    const reopened = await call("read_app_draft", { profileId: f.profileId, draftId: savedDraftPage.items[0].id });
    expect(reopened.content.subject).toBe("Question");
    const revised = await call("save_app_draft", {
      requestKey: "revise-reopened", draftId: reopened.id,
      expectedRevision: reopened.revision,
      content: { ...reopened.content, subject: "Updated question" },
    });
    expect(revised.recordId).toBe(reopened.id);
    expect((await call("read_app_draft", { profileId: f.profileId, draftId: reopened.id })).content.subject).toBe("Updated question");
    const completed = await call("complete_followup", {
      requestKey:"complete-reminder",profileId:f.profileId,followupId:existingReminder.id,
      expectedRevision:existingReminder.revision,reason:"Customer called and reviewed dates",
    });
    expect(completed.value.outcome).toBe("Customer called and reviewed dates");
    const obsolete = await call("save_followup", {
      requestKey:"obsolete-reminder",profileId:f.profileId,contactId:null,bookingId:null,
      kind:"email",dueAt:"2026-10-21T16:00:00Z",
    });
    const dismissInput = {requestKey:"dismiss-reminder",profileId:f.profileId,followupId:obsolete.recordId,
      expectedRevision:obsolete.revision,reason:"Superseded by committee review"};
    const dismissed = await call("dismiss_followup", dismissInput);
    expect(await call("dismiss_followup", dismissInput)).toEqual(dismissed);
    expect(dismissed.value.outcome).toBe("Dismissed: Superseded by committee review");
    expect((await call("list_followups", {profileId:f.profileId})).items.every((x:any)=>x.completedAt)).toBe(true);
    expect(
      (await f.db.query("SELECT * FROM chatgpt_external_drafts")).rows,
    ).toHaveLength(1);
    const duplicateId = randomUUID();
    await f.db.query("INSERT INTO organizations(id,name,city,region) VALUES($1,'County Fair old','New Town','UT')",[duplicateId]);
    const merge = await call("preview_profile_merge", {
      requestKey:"merge-preview",primaryId:f.profileId,duplicateIds:[duplicateId],
      reason:"Verified duplicate event",sources,
    });
    const settings=await request(app).get("/api/chatgpt-connection/").auth(owner,{type:"bearer"});
    const approveMerge=()=>request(app).post(`/api/chatgpt-connection/proposals/${merge.recordId}/approve-merge`).auth(owner,{type:"bearer"});
    expect((await approveMerge().send({contentHash:merge.value.contentHash,confirmedSameEvent:true})).status).toBe(403);
    expect((await approveMerge().set("Origin","https://app.example").set("X-Connection-CSRF",settings.body.csrfToken)
      .send({contentHash:merge.value.contentHash})).status).toBe(400);
    const approvedMerge=await approveMerge().set("Origin","https://app.example").set("X-Connection-CSRF",settings.body.csrfToken)
      .send({contentHash:merge.value.contentHash,confirmedSameEvent:true});
    expect(approvedMerge.status,approvedMerge.text).toBe(200);
    expect(approvedMerge.body.approvalId).toBeTruthy();
    expect((await f.db.query("SELECT id FROM organizations WHERE id=$1",[duplicateId])).rows).toHaveLength(1);
    await f.db.query(
      "UPDATE chatgpt_rate_windows SET calls=300,window_start=date_trunc('minute',clock_timestamp()) WHERE connection_id=$1",
      [f.principal.connectionId],
    );
    const limited = await request(app)
      .post("/api/chatgpt/mcp")
      .set("Host", "app.example")
      .set("Accept", "application/json, text/event-stream")
      .auth("test-connection", { type: "bearer" })
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(Number(limited.headers["retry-after"])).toBeLessThanOrEqual(60);
    expect(limited.body.retryAfterSeconds).toBe(Number(limited.headers["retry-after"]));
    expect(limited.headers["x-ratelimit-remaining"]).toBe("0");
    await f.db.query("UPDATE chatgpt_rate_windows SET calls=0");
    await f.db.query(
      "UPDATE chatgpt_connections SET revoked_at=now() WHERE id=$1",
      [f.principal.connectionId],
    );
    await expect(
      call("read_profile_context", { profileId: f.profileId, eventYear: 2027 }),
    ).rejects.toThrow("CONNECTION_REVOKED");
  } finally {
    await f.db.close();
  }
});


it("bounds the configurable connector allowance", () => {
  expect(connectionRequestsPerMinute("120")).toBe(120);
  expect(connectionRequestsPerMinute("60")).toBe(60);
  expect(connectionRequestsPerMinute("300")).toBe(300);
  for (const value of ["", "0", "-1", "Infinity", "301", "1.5", "garbage"]) {
    expect(connectionRequestsPerMinute(value)).toBe(120);
  }
});
