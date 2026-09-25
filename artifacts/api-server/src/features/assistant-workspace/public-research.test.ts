import { it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { researchPublicSources, ResearchCallStore } from "./public-research";
import { readModelConfig } from "./model-config";
import { ConversationStore } from "./conversation-store";
import { RunStore } from "./run-store";
import { emptySelection } from "./contracts";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
const config = () =>
  readModelConfig({
    ASSISTANT_WORKSPACE_ENABLED: "true",
    ASSISTANT_WORKSPACE_ACTOR_IDS: "owner",
    ASSISTANT_OPENAI_MODEL: "chosen-model",
    OPENAI_API_KEY: "test",
  });
const response = (status = "completed") => ({
  id: "response",
  status,
  usage: { input_tokens: 17, output_tokens: 13 },
  output: [
    {
      type: "web_search_call",
      status: "completed",
      action: {
        type: "search",
        sources: [
          { url: "https://city.example/fair", title: "City fair" },
          { url: "http://127.0.0.1/private" },
        ],
      },
    },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: "The city lists a fair.",
          annotations: [
            {
              type: "url_citation",
              url: "https://city.example/fair",
              title: "Fair",
              start_index: 0,
              end_index: 20,
            },
            {
              type: "url_citation",
              url: "https://user:password@example.com",
              title: "Unsafe",
              start_index: 0,
              end_index: 3,
            },
          ],
        },
      ],
    },
  ],
});
it("uses the chosen model and bounded public research, retaining citations separately from visited sources", async () => {
  let request: any;
  const r = await researchPublicSources(
    config(),
    "chosen-model",
    "Find public city fair details",
    new AbortController().signal,
    async (_url: any, init: any) => {
      request = JSON.parse(init.body);
      return new Response(JSON.stringify(response()), {
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  expect(request).toMatchObject({
    model: "chosen-model",
    store: false,
    max_tool_calls: 3,
    max_output_tokens: 4000,
    tools: [
      {
        type: "web_search",
        search_context_size: "low",
        external_web_access: true,
      },
    ],
  });
  expect(r.status).toBe("partial");
  expect(r.usage).toEqual({ inputTokens: 17, outputTokens: 13 });
  expect((r.data as any).parts[0].citations).toHaveLength(1);
  expect((r.data as any).consultedSources).toHaveLength(1);
  expect(JSON.stringify(r)).not.toContain("password");
  expect(JSON.stringify(r)).not.toContain("127.0.0.1");
});
it("never falls back to another model and retains usage for incomplete responses", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify(response("incomplete")), {
        headers: { "Content-Type": "application/json" },
      }),
  );
  expect(
    (
      await researchPublicSources(
        config(),
        "other",
        "query",
        new AbortController().signal,
        fetcher,
      )
    ).code,
  ).toBe("ASSISTANT_MODEL_UNAVAILABLE");
  expect(fetcher).not.toHaveBeenCalled();
  const r = await researchPublicSources(
    config(),
    "chosen-model",
    "query",
    new AbortController().signal,
    fetcher,
  );
  expect(r.status).toBe("partial");
  expect(r.usage).toEqual({ inputTokens: 17, outputTokens: 13 });
});
it("does not repeat a research call after an interrupted outcome and scopes the durable ledger", async () => {
  const db = new PGlite();
  try {
    await ensureAssistantWorkspaceSchema(db);
    const conversations = new ConversationStore(db),
      runs = new RunStore(db);
    const c = await conversations.create("owner", "Research");
    const run = await runs.submit(
      {
        actor: { id: "owner", role: "owner", connectionId: null },
        conversationId: c.id,
        requestKey: "research",
        selection: emptySelection(),
        grants: [],
        model: "chosen-model",
      },
      "Research",
    );
    const context = {
      ...run.input,
      runId: run.id,
      signal: new AbortController().signal,
    };
    const store = new ResearchCallStore(db),
      work = vi.fn(async () => {
        throw new Error("interrupted");
      });
    const first = await store.execute(context, "call", { query: "fair" }, work);
    expect(first.status).toBe("uncertain");
    expect(first.usageUnknown).toBe(true);
    const retry = await store.execute(context, "call", { query: "fair" }, work);
    expect(retry.status).toBe("uncertain");
    expect(work).toHaveBeenCalledTimes(1);
    await expect(
      store.execute(
        { ...context, actor: { ...context.actor, id: "other" } },
        "call",
        { query: "fair" },
        work,
      ),
    ).rejects.toThrow("ASSISTANT_RUN_NOT_FOUND");
  } finally {
    await db.close();
  }
}, 30000);
import { safePublicUrl } from "./public-research";
it("rejects DNS-root-dot local and internal URLs", () => {
  for (const url of [
    "http://localhost./",
    "http://service.internal./",
    "http://foo.localhost./",
  ])
    expect(safePublicUrl(url)).toBeNull();
});
