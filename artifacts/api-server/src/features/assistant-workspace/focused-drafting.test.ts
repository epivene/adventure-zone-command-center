import { afterEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { DraftStore } from "./draft-store";
import { emptySelection, type ToolCall } from "./contracts";
import { createOpenAiModel } from "./openai-model";
import { readModelConfig } from "./model-config";
import { runTurn, type TurnCheckpoint } from "./orchestrator";
import { productionReads } from "./production-reads";
import { createReadTools, result } from "./read-tools";
import { createWorkspaceTools } from "./workspace-tools";
import { createToolRegistry } from "./tool-registry";
let db: PGlite;
afterEach(async () => {
  if (db) await db.close();
});
it("saves a neutral deposit follow-up with nine tools in five model rounds, including two complete threads", async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  const org = "11111111-1111-4111-8111-111111111111",
    template = "22222222-2222-4222-8222-222222222222";
  await db.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY,name text,updated_at timestamptz,consolidated_into_id uuid);
  CREATE TABLE contacts(id uuid,email text);
  CREATE TABLE organization_contacts(organization_id uuid,contact_id uuid,active boolean);
  CREATE TABLE communication_templates(id uuid,code text,name text,template_version text,subject_template text,body_template text,body_format text,required_placeholders jsonb,state text,reviewed_at timestamptz);
  INSERT INTO organizations VALUES('${org}','BBQ Days',now(),null);
  INSERT INTO contacts VALUES('${org}','contact@example.com');
  INSERT INTO organization_contacts VALUES('${org}','${org}',true);
  INSERT INTO communication_templates VALUES('${template}','reply','Reply','v1','The Adventure Zone','<p>Hello</p>','html','[]','active',now());`);
  const conversations = new ConversationStore(db),
    drafts = new DraftStore(db),
    c = await conversations.create("owner", "Deposit follow-up");
  const selection = {
    ...emptySelection(),
    organizationIds: [org],
    eventYear: 2027,
  };
  await conversations.setSelection("owner", c.id, c.version, selection);
  const context = {
    actor: { id: "owner", role: "owner" as const, connectionId: "gmail" },
    conversationId: c.id,
    runId: "r",
    selection,
    grants: [],
    signal: new AbortController().signal,
  };
  const reads = createReadTools({
    ownerId: "owner",
    adapters: productionReads(db as any, "owner", {} as any).adapters,
    gmail: async () => ({
      connectionId: "gmail",
      client: {
        listMessagePage: async () => ({
          messages: [
            { id: "message1", threadId: "thread1" },
            { id: "message2", threadId: "thread2" },
          ],
          nextPageToken: null,
        }),
        getThreadDetail: async (id: string) => ({
          id,
          messages: [
            {
              id: id + "in",
              direction: "incoming",
              bodyText: "Could you check the deposit?",
            },
            {
              id: id + "out",
              direction: "sent",
              bodyText: "I will follow up.",
            },
          ],
        }),
      } as any,
    }),
  });
  const registry = createToolRegistry([
    reads,
    createWorkspaceTools({
      ownerId: "owner",
      db,
      conversations,
      drafts,
    } as any),
    {
      definitions: () => [
        {
          type: "function",
          name: "read_commercial_records",
          parameters: { type: "object" },
        },
      ],
      execute: async () => ({
        ...result({
          eventYear: 2027,
          recordedPayments: 0,
          unclassifiedCount: 1,
        }),
        status: "partial" as const,
        code: "ASSISTANT_EVENT_YEAR_UNCLASSIFIED",
      }),
    },
  ]);
  const content = {
    to: ["contact@example.com"],
    cc: [],
    subject: "The Adventure Zone: BBQ Days deposit follow-up",
    html: "<p>Hi, could you let us know whether the deposit has been sent?</p>",
    text: "Hi, could you let us know whether the deposit has been sent?",
    threadId: "thread1",
    attachmentHashes: [],
    attachmentIds: [],
    organizationId: org,
    templateId: template,
    templateVersion: "v1",
  };
  let sequence = 0;
  const call = (name: string, args: unknown): ToolCall => ({
    id: `call${++sequence}`,
    name,
    arguments: JSON.stringify(args),
  });
  const batches = [
    [
      call("read_profile", { organizationId: org }),
      call("read_rules", { organizationId: org, eventYear: 2027 }),
      call("read_commercial_records", {}),
      call("read_templates", { offset: null }),
    ],
    [
      call("search_email", { query: "BBQ Days", cursor: null }),
      call("read_template", { templateId: template }),
    ],
    [
      call("read_email_thread", { threadId: "thread1" }),
      call("read_email_thread", { threadId: "thread2" }),
    ],
    [call("prepare_draft", content)],
  ];
  let round = 0;
  const model = createOpenAiModel(
    readModelConfig({
      ASSISTANT_WORKSPACE_ENABLED: "true",
      ASSISTANT_WORKSPACE_ACTOR_IDS: "owner",
      ASSISTANT_OPENAI_MODEL: "test",
      OPENAI_API_KEY: "test",
    }),
    async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      expect(request.parallel_tool_calls).toBe(true);
      const calls = batches[round++];
      const output = calls
        ? calls.map((c) => ({
            type: "function_call",
            call_id: c.id,
            name: c.name,
            arguments: c.arguments,
          }))
        : [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: "The follow-up draft is ready for review.",
                },
              ],
            },
          ];
      return new Response(
        `data: ${JSON.stringify({ type: "response.completed", response: { id: "r", status: "completed", output, usage: { input_tokens: 100, output_tokens: 20 } } })}\n\ndata: [DONE]\n\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  );
  let cp: TurnCheckpoint | undefined;
  const answer = await runTurn(context, model, registry, {
    load: async () => ({
      turns: [{ role: "user", text: "Draft a deposit follow-up" }],
      state: selection,
      evidence: [],
      checkpoint: cp,
    }),
    save: async (value) => {
      cp = structuredClone(value);
    },
    check: async () => {},
  });
  expect(answer.status).toBe("succeeded");
  expect(cp?.steps).toBe(5);
  expect(Object.keys(cp!.results)).toHaveLength(9);
  expect(cp?.evidence.filter((e) => e.kind === "email")).toHaveLength(2);
  expect(answer.receipts).toEqual([
    expect.objectContaining({ kind: "app_draft" }),
  ]);
  const saved = await drafts.list("owner", c.id);
  expect(saved).toHaveLength(1);
  expect(saved[0].content.text).toBe(content.text);
  expect(saved[0].status).toBe("local");
  expect(context.grants).toEqual([]);
});
