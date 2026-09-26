import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { RunStore } from "./run-store";
import { DocumentExtractionStore } from "./document-extraction-store";
import { emptySelection, type RunContext, type ToolResult } from "./contracts";
let db: PGlite, store: DocumentExtractionStore, context: RunContext;
const visualCostCall = {
  responseId: "visual-response",
  source: "document" as const,
  model: "gpt-6-sol",
  serviceTier: "default",
  inputTokens: 12,
  cachedInputTokens: 2,
  cacheWriteTokens: 0,
  outputTokens: 7,
  observedAt: "2026-09-25T00:00:00.000Z",
  pricingVersion: "test-rate-card",
  estimatedUsd: 0.0002,
  excluded: [],
};
const output: ToolResult = {
  status: "partial",
  data: { missingPages: [1], complete: false },
  evidence: [],
  receipts: [],
  code: "ASSISTANT_DOCUMENT_VISUAL_REVIEW_REQUIRED",
  usage: { inputTokens: 40, outputTokens: 10 },
  costCalls: [visualCostCall],
};
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  await ensureAssistantWorkspaceSchema(db);
  const conversations = new ConversationStore(db),
    runs = new RunStore(db);
  const c = await conversations.create("owner", "Reading");
  const run = await runs.submit(
    {
      actor: { id: "owner", role: "owner", connectionId: "g" },
      conversationId: c.id,
      requestKey: "read",
      selection: emptySelection(),
      grants: [],
    },
    "Read the file",
  );
  context = {
    ...run.input,
    runId: run.id,
    signal: new AbortController().signal,
    toolCallId: "call1",
  };
  store = new DocumentExtractionStore(db);
});
afterEach(async () => {
  await db.close();
});
it("reuses partial readings and charges recovery once to the original tool call", async () => {
  const work = vi.fn(async () => structuredClone(output));
  const first = await store.execute(context, "same", work);
  const replay = await store.execute(context, "same", work);
  const reuse = await store.execute(
    { ...context, toolCallId: "call2" },
    "same",
    work,
  );
  expect(work).toHaveBeenCalledTimes(1);
  expect(replay.usage).toEqual(first.usage);
  expect(first.costCalls).toEqual([visualCostCall]);
  expect(replay.costCalls).toEqual([visualCostCall]);
  expect(reuse.usage).toBeUndefined();
  expect(reuse.costCalls).toBeUndefined();
  expect(reuse.data).toMatchObject({
    missingPages: [1],
    complete: false,
    cacheHit: true,
  });
  await store.execute(context, "changed-bytes", work);
  expect(work).toHaveBeenCalledTimes(2);
});
it("does not repeat concurrent or interrupted extraction even from another run", async () => {
  let release!: (value: ToolResult) => void;
  const work = vi.fn(
    () =>
      new Promise<ToolResult>((resolve) => {
        release = resolve;
      }),
  );
  const first = store.execute(context, "lock", work);
  await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(1));
  const concurrent = await store.execute(
    { ...context, toolCallId: "call2" },
    "lock",
    work,
  );
  expect(concurrent.usageUnknown).toBe(true);
  release(output);
  await first;
  const crash = vi.fn(async () => {
    throw new Error("connection reset after submission");
  });
  expect((await store.execute(context, "crash", crash)).usageUnknown).toBe(
    true,
  );
  const runs = new RunStore(db),
    conversations = new ConversationStore(db);
  const c = await conversations.create("owner", "Second run");
  const run = await runs.submit(
    {
      ...context,
      conversationId: c.id,
      requestKey: "next",
      model: "different",
    },
    "Read again",
  );
  expect(
    (
      await store.execute(
        { ...context, runId: run.id, conversationId: c.id },
        "crash",
        crash,
      )
    ).usageUnknown,
  ).toBe(true);
  expect(crash).toHaveBeenCalledTimes(1);
});
it("rejects forged run ownership before disclosing a cached reading", async () => {
  await store.execute(context, "owned", async () => output);
  const work = vi.fn(async () => output);
  await expect(
    store.execute(
      { ...context, actor: { ...context.actor, id: "other" } },
      "owned",
      work,
    ),
  ).rejects.toThrow("ASSISTANT_RUN_NOT_FOUND");
  expect(work).not.toHaveBeenCalled();
});

it("does not charge a reused extraction to another run with the same tool call ID", async () => {
  await store.execute(context, "reused", async () => structuredClone(output));
  const runs = new RunStore(db);
  const conversation = await new ConversationStore(db).create("owner", "Reuse");
  const run = await runs.submit(
    {
      ...context,
      conversationId: conversation.id,
      requestKey: "another-run",
    },
    "Read it again",
  );
  const reused = await store.execute(
    { ...context, runId: run.id, conversationId: conversation.id },
    "reused",
    async () => {
      throw new Error("Cached extraction must not call the provider");
    },
  );
  expect(reused.data).toMatchObject({ cacheHit: true });
  expect(reused.usage).toBeUndefined();
  expect(reused.costCalls).toBeUndefined();
});
