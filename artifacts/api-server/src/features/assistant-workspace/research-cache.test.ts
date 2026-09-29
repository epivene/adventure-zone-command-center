import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { RunStore } from "./run-store";
import { ResearchCallStore } from "./public-research";
import { SavedResearchCache } from "./research-cache";
import {
  emptySelection,
  type RunContext,
  type Selection,
  type ToolResult,
} from "./contracts";

let db: PGlite;
let sequence = 0;
let now: Date;
let cache: SavedResearchCache;
const orgOne = "11111111-1111-4111-8111-111111111111";
const orgTwo = "22222222-2222-4222-8222-222222222222";
const initialSelection = () => ({
  ...emptySelection(),
  organizationIds: [orgOne, orgTwo],
  eventYear: 2027,
});
beforeAll(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
});
afterAll(async () => {
  await db?.close();
});

async function context(
  options: {
    previous?: RunContext;
    owner?: string;
    selection?: Selection;
  } = {},
): Promise<RunContext> {
  now = new Date();
  cache = new SavedResearchCache(db, () => now);
  const actor = {
    id: options.owner ?? "owner",
    role: "owner" as const,
    connectionId: null,
  };
  const conversationId =
    options.previous?.conversationId ??
    (await new ConversationStore(db).create(actor.id, "Research")).id;
  if (options.previous)
    await db.query(
      "UPDATE assistant_workspace_runs SET status='succeeded' WHERE id=$1",
      [options.previous.runId],
    );
  const run = await new RunStore(db).submit(
    {
      actor,
      conversationId,
      requestKey: `run-${++sequence}`,
      selection:
        options.selection ?? options.previous?.selection ?? initialSelection(),
      grants: [],
      model: "gpt-6-luna",
    },
    "Continue",
  );
  return { ...run.input, runId: run.id, signal: new AbortController().signal };
}
function report(query = "Find the official fair contact"): ToolResult {
  return {
    status: "ok",
    code: null,
    data: {
      view: "public_research",
      query,
      model: "gpt-6-luna",
      complete: true,
      parts: [
        {
          text: "Official fair page.",
          citations: [
            {
              url: "https://city.example/fair",
              title: "City fair",
              startIndex: 0,
              endIndex: 18,
            },
          ],
        },
      ],
      consultedSources: [
        { url: "https://city.example/fair", title: "City fair" },
      ],
      warnings: ["Public evidence requires current review."],
    },
    evidence: [
      {
        id: "web:0:0",
        kind: "web",
        recordId: "https://city.example/fair",
        eventYear: null,
        occurredAt: null,
        retrievedAt: now.toISOString(),
        version: null,
        complete: true,
        text: "Official fair page.",
      },
    ],
    receipts: [],
    usage: { inputTokens: 100, outputTokens: 50 },
    costCalls: [{ responseId: "paid-response", estimatedUsd: 0.01 } as any],
  };
}
const execute = (
  c: RunContext,
  work: () => Promise<ToolResult>,
  options: { query?: string; model?: string; refresh?: boolean } = {},
) => {
  const query = options.query ?? "Find the official fair contact";
  const model = options.model ?? "gpt-6-luna";
  return new ResearchCallStore(db).execute(
    c,
    `call-${++sequence}`,
    { query, model },
    () => cache.execute(c, query, model, work, options.refresh),
  );
};

it("reuses a completed cited report across runs without replaying paid usage or refreshing source timestamps", async () => {
  const first = await context();
  const work = vi.fn(async () => report());
  const original = await execute(first, work);
  const saved = (original.data as any).savedResearch;
  expect(saved).toMatchObject({
    version: 1,
    id: expect.any(String),
    reusedAt: null,
    stale: false,
  });
  const second = await context({
    previous: first,
    selection: {
      ...first.selection,
      organizationIds: [...first.selection.organizationIds].reverse(),
    },
  });
  now = new Date(Date.parse(saved.generatedAt) + 2000);
  const hit = await execute(second, work, {
    query: "  Find   the official fair contact  ",
  });
  expect(work).toHaveBeenCalledTimes(1);
  expect(hit.usage).toBeUndefined();
  expect(hit.usageUnknown).toBeUndefined();
  expect(hit.costCalls).toBeUndefined();
  expect(hit.receipts).toEqual([]);
  expect(hit.evidence).toEqual(original.evidence);
  expect((hit.data as any).savedResearch).toMatchObject({
    id: saved.id,
    generatedAt: saved.generatedAt,
    expiresAt: saved.expiresAt,
    reusedAt: now.toISOString(),
  });
  expect(original.costCalls).toHaveLength(1);
  const index = await cache.listIndex(second);
  expect(index).toHaveLength(1);
  expect(index[0].complete).toBe(false);
  expect(index[0].retrievedAt).toBe(saved.generatedAt);
  const summary = JSON.parse(index[0].text);
  expect(summary).toMatchObject({
    historical: true,
    untrusted: true,
    status: "research_report_saved",
    sourceIds: ["https://city.example/fair"],
    reportTool: "read_saved_research",
  });
  expect(summary).not.toHaveProperty("instructions");
  const read = await cache.readSavedResearch(second, saved.id);
  expect(read.evidence).toEqual(original.evidence);
  expect(read.costCalls).toBeUndefined();
  expect(read.usage).toBeUndefined();
});

it("requires the same owner, conversation, selected records, event year, model and query", async () => {
  const first = await context();
  const work = vi.fn(async () => report());
  const original = await execute(first, work);
  const savedId = (original.data as any).savedResearch.id;
  const unauthorized = {
    ...first,
    actor: { ...first.actor, id: "another-owner" },
  };
  expect(
    (
      await cache.execute(
        unauthorized,
        "Find the official fair contact",
        "gpt-6-luna",
        work,
      )
    ).code,
  ).toBe("ASSISTANT_RUN_NOT_FOUND");
  expect(await cache.listIndex(unauthorized)).toEqual([]);
  expect((await cache.readSavedResearch(unauthorized, savedId)).code).toBe(
    "ASSISTANT_RUN_NOT_FOUND",
  );
  for (const other of [
    await context(),
    await context({ owner: "another-owner" }),
  ]) {
    await execute(other, work);
    expect((await cache.readSavedResearch(other, savedId)).code).toBe(
      "ASSISTANT_SAVED_RESEARCH_NOT_FOUND",
    );
  }
  let prior = first;
  for (const selection of [
    { ...first.selection, organizationIds: [orgOne] },
    { ...first.selection, eventYear: 2028 },
    { ...first.selection, threadId: "different-thread" },
    { ...first.selection, draftId: "different-draft" },
  ]) {
    const changed = await context({ previous: prior, selection });
    expect(await cache.listIndex(changed)).toEqual([]);
    expect((await cache.readSavedResearch(changed, savedId)).code).toBe(
      "ASSISTANT_SAVED_RESEARCH_NOT_FOUND",
    );
    await execute(changed, work);
    prior = changed;
  }
  const current = await context({
    previous: prior,
    selection: first.selection,
  });
  await execute(current, work, { model: "gpt-6-sol" });
  await execute(
    current,
    async () => {
      work();
      return report("Find a different fair");
    },
    { query: "Find a different fair" },
  );
  expect(work).toHaveBeenCalledTimes(9);
});

it("does not reuse partial, uncited, uncertain, legacy or malformed results", async () => {
  const c = await context();
  const variants = [
    { ...report(), status: "partial", code: "ASSISTANT_RESEARCH_INCOMPLETE" },
    { ...report(), usageUnknown: true },
    { ...report(), evidence: [] },
    { ...report(), data: { ...(report().data as any), complete: false } },
    {
      ...report(),
      data: {
        ...(report().data as any),
        parts: [{ text: "No citations", citations: [] }],
      },
    },
    {
      ...report(),
      evidence: [
        { ...report().evidence[0], recordId: "https://different.example/" },
      ],
    },
  ];
  for (const variant of variants) {
    const work = vi.fn(async () => variant as ToolResult);
    await execute(c, work);
    await execute(c, work);
    expect(work).toHaveBeenCalledTimes(2);
  }
  await new ResearchCallStore(db).execute(
    c,
    "legacy",
    { query: "Find the official fair contact" },
    async () => report(),
  );
  expect(await cache.listIndex(c)).toEqual([]);
  const fresh = vi.fn(async () => report());
  await execute(c, fresh);
  expect(fresh).toHaveBeenCalledTimes(1);
});

it("expires automatic reuse after 24 hours and supports deliberate refresh without extending old validity", async () => {
  const c = await context();
  const work = vi.fn(async () => report());
  const first = await execute(c, work);
  const saved = (first.data as any).savedResearch;
  now = new Date(Date.parse(saved.generatedAt) + 1000);
  await execute(c, work);
  expect(work).toHaveBeenCalledTimes(1);
  await execute(c, work, { refresh: true });
  expect(work).toHaveBeenCalledTimes(2);
  now = new Date(Date.parse(saved.generatedAt) + 24 * 60 * 60 * 1000 + 2000);
  const historical = await cache.readSavedResearch(c, saved.id);
  expect((historical.data as any).savedResearch).toMatchObject({
    stale: true,
    generatedAt: saved.generatedAt,
    expiresAt: saved.expiresAt,
  });
  expect(historical.evidence[0].retrievedAt).toBe(
    first.evidence[0].retrievedAt,
  );
  await execute(c, work);
  expect(work).toHaveBeenCalledTimes(3);
});

it("blocks cancelled requests and malformed arguments before any paid work", async () => {
  const c = await context();
  const work = vi.fn(async () => report());
  const controller = new AbortController();
  controller.abort();
  expect(
    (
      await cache.execute(
        { ...c, signal: controller.signal },
        "Find the official fair contact",
        "gpt-6-luna",
        work,
      )
    ).code,
  ).toBe("ASSISTANT_CANCELLED");
  expect((await cache.execute(c, " ", "gpt-6-luna", work)).code).toBe(
    "ASSISTANT_ARGUMENTS_INVALID",
  );
  expect((await cache.readSavedResearch(c, "not-an-id")).code).toBe(
    "ASSISTANT_ARGUMENTS_INVALID",
  );
  expect(work).not.toHaveBeenCalled();
});

it("bounds the historical index and uses unique evidence IDs for independent reports", async () => {
  const c = await context();
  const evidenceIds = new Set<string>();
  for (let i = 0; i < 23; i++) {
    now = new Date(now.getTime() + 1);
    const query = `Official fair ${i}: ${"long question ".repeat(40)}`;
    const saved = await execute(c, async () => report(query), { query });
    evidenceIds.add(saved.evidence[0].id);
  }
  expect(evidenceIds.size).toBe(23);
  const index = await cache.listIndex(c);
  expect(index).toHaveLength(20);
  const summaries = index.map((e) => JSON.parse(e.text));
  expect(summaries[0].question).toContain("fair 22:");
  expect(
    summaries.every((s) => s.question.length <= 400 && s.questionTruncated),
  ).toBe(true);
  expect(summaries.some((s) => s.question.includes("fair 0:"))).toBe(false);
});
