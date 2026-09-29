import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { SpendingStore, type SpendingScope } from "./spending-store";

let db: PGlite;
let store: SpendingStore;
let scope: SpendingScope;
let now: Date;
const nanos = (usd: number) => Math.round(usd * 1_000_000_000);
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  now = new Date("2026-09-26T12:00:00Z");
  store = new SpendingStore(drizzle(db), db, () => now);
  const conversations = new ConversationStore(db);
  const conversation = await conversations.create("owner", "Budget test");
  const message = await conversations.append(
    "owner",
    conversation.id,
    "source",
    {
      role: "user",
      text: "Help me research",
    },
  );
  const runId = randomUUID();
  await db.query(
    `INSERT INTO assistant_workspace_runs(id,conversation_id,actor_id,request_key,source_message_id,status)
    VALUES($1,$2,'owner','run',$3,'running')`,
    [runId, conversation.id, message.id],
  );
  scope = {
    actorId: "owner",
    conversationId: conversation.id,
    runId,
    callId: `assistant:${runId}:1`,
    source: "assistant",
    model: "gpt-6-luna",
  };
}, 30000);
afterEach(async () => {
  if (db && !db.closed) await db.close();
});

it("starts at one dollar with an explicit UTC day and activation time, and persists preferences", async () => {
  const initial = await store.summary("owner");
  expect(initial).toMatchObject({
    version: 1,
    dailyLimitUsd: 1,
    economyMode: true,
    day: "2026-09-26",
    resetAt: "2026-09-27T00:00:00.000Z",
    trackingStartedAt: "2026-09-26T12:00:00.000Z",
    spentUsd: 0,
    reservedUsd: 0,
    remainingUsd: 1,
    paused: false,
    currency: "USD",
    unknownCalls: 0,
  });
  await store.update("owner", {
    version: 1,
    dailyLimitUsd: 2.35,
    economyMode: false,
  });
  const restarted = new SpendingStore(drizzle(db), db, () => now);
  expect(await restarted.summary("owner")).toMatchObject({
    version: 2,
    dailyLimitUsd: 2.35,
    economyMode: false,
    trackingStartedAt: initial.trackingStartedAt,
  });
  expect(await store.summary("other")).toMatchObject({
    version: 1,
    dailyLimitUsd: 1,
    economyMode: true,
  });
});

it("reserves atomically across concurrent calls so only one can use the remaining allowance", async () => {
  const results = await Promise.allSettled([
    store.reserve(scope, nanos(0.6)),
    store.reserve({ ...scope, callId: `${scope.callId}:other` }, nanos(0.6)),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: new Error("ASSISTANT_BUDGET_LIMIT"),
  });
  expect(await store.summary("owner")).toMatchObject({
    reservedUsd: 0.6,
    remainingUsd: 0.4,
  });
});

it("fails duplicate calls closed even after settlement, without charging or releasing them again", async () => {
  const results = await Promise.allSettled([
    store.reserve(scope, nanos(0.2)),
    store.reserve(scope, nanos(0.2)),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: new Error("ASSISTANT_BUDGET_CALL_EXISTS"),
  });
  await store.settle("owner", scope.callId, nanos(0.1));
  await expect(store.reserve(scope, nanos(0.2))).rejects.toThrow(
    "ASSISTANT_BUDGET_CALL_EXISTS",
  );
  expect(await store.summary("owner")).toMatchObject({
    spentUsd: 0.1,
    reservedUsd: 0,
    remainingUsd: 0.9,
  });
});

it("protects settings with compare-and-swap and rejects invalid money without mutating preferences", async () => {
  const results = await Promise.allSettled([
    store.update("owner", { version: 1, dailyLimitUsd: 2, economyMode: true }),
    store.update("owner", { version: 1, dailyLimitUsd: 3, economyMode: false }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: new Error("ASSISTANT_SPENDING_CONFLICT"),
  });
  for (const amount of [
    -1,
    1000.01,
    1.005,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "2" as unknown as number,
  ]) {
    await expect(
      store.update("owner", {
        version: 2,
        dailyLimitUsd: amount,
        economyMode: true,
      }),
    ).rejects.toThrow("ASSISTANT_SPENDING_INVALID");
  }
  expect((await store.summary("owner")).version).toBe(2);
});

it("lets the owner pause at zero or lower the limit without cancelling existing reservations", async () => {
  await store.reserve(scope, nanos(0.6));
  expect(
    await store.update("owner", {
      version: 1,
      dailyLimitUsd: 0.25,
      economyMode: true,
    }),
  ).toMatchObject({
    paused: true,
    reservedUsd: 0.6,
    remainingUsd: 0,
  });
  await expect(
    store.reserve({ ...scope, callId: "second" }, 1),
  ).rejects.toThrow("ASSISTANT_BUDGET_LIMIT");
  await store.settle("owner", scope.callId, nanos(0.2));
  expect(await store.summary("owner")).toMatchObject({
    spentUsd: 0.2,
    reservedUsd: 0,
    remainingUsd: 0.05,
    paused: false,
  });
  await store.update("owner", {
    version: 2,
    dailyLimitUsd: 0,
    economyMode: true,
  });
  await expect(store.reserve({ ...scope, callId: "third" }, 1)).rejects.toThrow(
    "ASSISTANT_BUDGET_LIMIT",
  );
});

it("retains uncertain holds across day rollover and does not count yesterday's measured spend as today's", async () => {
  await store.reserve(scope, nanos(0.7));
  await store.settle("owner", scope.callId, null);
  await store.reserve({ ...scope, callId: "settled-yesterday" }, nanos(0.2));
  await store.settle("owner", "settled-yesterday", nanos(0.1));
  expect(await store.summary("owner")).toMatchObject({
    spentUsd: 0.1,
    reservedUsd: 0.7,
    unknownCalls: 1,
  });
  now = new Date("2026-09-27T12:00:00Z");
  expect(await store.summary("owner")).toMatchObject({
    day: "2026-09-27",
    spentUsd: 0,
    reservedUsd: 0.7,
    remainingUsd: 0.3,
    unknownCalls: 1,
    resetAt: "2026-09-28T00:00:00.000Z",
  });
  await expect(
    store.reserve({ ...scope, callId: "too-large-next-day" }, nanos(0.4)),
  ).rejects.toThrow("ASSISTANT_BUDGET_LIMIT");
  await store.settle("owner", scope.callId, nanos(0.5));
  expect(await store.summary("owner")).toMatchObject({
    spentUsd: 0,
    reservedUsd: 0,
    remainingUsd: 1,
    unknownCalls: 0,
  });
});

it("settles idempotently, never lowers a recorded charge and records an overrun in full", async () => {
  await store.reserve(scope, nanos(0.5));
  await store.settle("owner", scope.callId, nanos(0.3));
  await store.settle("owner", scope.callId, nanos(0.3));
  await store.settle("owner", scope.callId, nanos(0.1));
  await store.settle("owner", scope.callId, null);
  expect(await store.summary("owner")).toMatchObject({
    spentUsd: 0.3,
    reservedUsd: 0,
    unknownCalls: 0,
  });
  await store.settle("owner", scope.callId, nanos(1.2));
  expect(await store.summary("owner")).toMatchObject({
    spentUsd: 1.2,
    reservedUsd: 0,
    remainingUsd: 0,
    paused: true,
  });
  await expect(
    store.reserve({ ...scope, callId: "after-overrun" }, 1),
  ).rejects.toThrow("ASSISTANT_BUDGET_LIMIT");
});

it("can release a reservation only through a confirmed zero settlement while retaining its replay guard", async () => {
  await store.reserve(scope, nanos(1));
  expect((await store.summary("owner")).paused).toBe(true);
  await store.settle("owner", scope.callId, 0);
  expect(await store.summary("owner")).toMatchObject({
    spentUsd: 0,
    reservedUsd: 0,
    remainingUsd: 1,
    paused: false,
  });
  await expect(store.reserve(scope, nanos(1))).rejects.toThrow(
    "ASSISTANT_BUDGET_CALL_EXISTS",
  );
});

it("isolates ownership, conversation and run, and refuses settlement of another owner's call", async () => {
  await expect(
    store.reserve({ ...scope, actorId: "other" }, nanos(0.1)),
  ).rejects.toThrow("ASSISTANT_SPENDING_INVALID");
  await expect(
    store.reserve({ ...scope, conversationId: randomUUID() }, nanos(0.1)),
  ).rejects.toThrow("ASSISTANT_SPENDING_INVALID");
  await expect(
    store.reserve({ ...scope, runId: randomUUID() }, nanos(0.1)),
  ).rejects.toThrow("ASSISTANT_SPENDING_INVALID");
  await store.reserve(scope, nanos(0.1));
  await expect(store.settle("other", scope.callId, 0)).rejects.toThrow(
    "ASSISTANT_SPENDING_INVALID",
  );
  expect(await store.summary("owner")).toMatchObject({
    reservedUsd: 0.1,
    spentUsd: 0,
  });
  expect(await store.summary("other")).toMatchObject({
    reservedUsd: 0,
    spentUsd: 0,
  });
});

it("rejects fractional, unsafe and empty reservations without consuming budget", async () => {
  for (const amount of [0, -1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(store.reserve(scope, amount)).rejects.toThrow(
      "ASSISTANT_SPENDING_INVALID",
    );
  }
  await store.reserve(scope, 1);
  await expect(store.settle("owner", scope.callId, -1)).rejects.toThrow(
    "ASSISTANT_SPENDING_INVALID",
  );
  expect((await store.summary("owner")).reservedUsd).toBe(0.000000001);
});

it("charges chat, research and documents to the same limit, and preserves the ledger through startup replay", async () => {
  await store.reserve(scope, nanos(0.3));
  await store.settle("owner", scope.callId, nanos(0.2));
  await store.reserve(
    { ...scope, source: "research", callId: "research-call" },
    nanos(0.4),
  );
  await store.reserve(
    { ...scope, source: "document", callId: "document-call" },
    nanos(0.4),
  );
  await ensureAssistantWorkspaceSchema(db);
  expect(await store.summary("owner")).toMatchObject({
    spentUsd: 0.2,
    reservedUsd: 0.8,
    remainingUsd: 0,
    paused: true,
  });
  await expect(
    store.reserve({ ...scope, callId: "one-more" }, 1),
  ).rejects.toThrow("ASSISTANT_BUDGET_LIMIT");
});

it("refuses new reservations for cancelled or completed runs but still permits settlement", async () => {
  await store.reserve(scope, nanos(0.5));
  await db.query(
    "UPDATE assistant_workspace_runs SET cancel_requested_at=now() WHERE id=$1",
    [scope.runId],
  );
  await expect(
    store.reserve({ ...scope, callId: "cancelled" }, 1),
  ).rejects.toThrow("ASSISTANT_SPENDING_INVALID");
  await db.query(
    "UPDATE assistant_workspace_runs SET status='succeeded',cancel_requested_at=NULL WHERE id=$1",
    [scope.runId],
  );
  await expect(
    store.reserve({ ...scope, callId: "completed" }, 1),
  ).rejects.toThrow("ASSISTANT_SPENDING_INVALID");
  await store.settle("owner", scope.callId, nanos(0.2));
  expect(await store.summary("owner")).toMatchObject({
    spentUsd: 0.2,
    reservedUsd: 0,
  });
});

it("enforces monthly spending across daily resets and retains uncertain holds across month boundaries", async () => {
  await store.update("owner", {
    version: 1,
    dailyLimitUsd: 1,
    monthlyLimitUsd: 0.8,
    economyMode: true,
  });
  await store.reserve(scope, nanos(0.6));
  await store.settle("owner", scope.callId, nanos(0.5));
  now = new Date("2026-09-27T12:00:00Z");
  expect(await store.summary("owner")).toMatchObject({
    spentUsd: 0,
    monthlySpentUsd: 0.5,
    monthlyLimitUsd: 0.8,
    monthlyRemainingUsd: 0.3,
    remainingUsd: 0.3,
    monthlyResetAt: "2026-10-01T00:00:00.000Z",
  });
  const results = await Promise.allSettled([
    store.reserve({ ...scope, callId: "monthly-a" }, nanos(0.2)),
    store.reserve({ ...scope, callId: "monthly-b" }, nanos(0.2)),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const held = results[0].status === "fulfilled" ? "monthly-a" : "monthly-b";
  await store.settle("owner", held, null);
  now = new Date("2026-10-01T00:00:00Z");
  expect(await store.summary("owner")).toMatchObject({
    monthlySpentUsd: 0,
    reservedUsd: 0.2,
    monthlyRemainingUsd: 0.6,
    remainingUsd: 0.6,
    monthlyResetAt: "2026-11-01T00:00:00.000Z",
  });
});

it("zero monthly limit pauses even with daily allowance and stale updates cannot raise it", async () => {
  await store.update("owner", {
    version: 1,
    dailyLimitUsd: 5,
    monthlyLimitUsd: 0,
    economyMode: true,
  });
  expect(await store.summary("owner")).toMatchObject({
    paused: true,
    remainingUsd: 0,
    monthlyLimitUsd: 0,
  });
  await expect(store.reserve(scope, 1)).rejects.toThrow(
    "ASSISTANT_BUDGET_LIMIT",
  );
  await expect(
    store.update("owner", {
      version: 1,
      dailyLimitUsd: 5,
      monthlyLimitUsd: 30,
      economyMode: true,
    }),
  ).rejects.toThrow("ASSISTANT_SPENDING_CONFLICT");
  await store.update("owner", {
    version: 2,
    dailyLimitUsd: 6,
    economyMode: false,
  });
  expect(await store.summary("owner")).toMatchObject({
    monthlyLimitUsd: 0,
    paused: true,
  });
});

it("rejects invalid monthly limits and preserves settings on startup replay", async () => {
  for (const amount of [-1, 1000.01, 0.001, NaN, Infinity, null, "2"]) {
    await expect(
      store.update("owner", {
        version: 1,
        dailyLimitUsd: 1,
        monthlyLimitUsd: amount as number,
        economyMode: true,
      }),
    ).rejects.toThrow("ASSISTANT_SPENDING_INVALID");
  }
  await store.update("owner", {
    version: 1,
    dailyLimitUsd: 2,
    monthlyLimitUsd: 15.25,
    economyMode: true,
  });
  await ensureAssistantWorkspaceSchema(db);
  expect(await store.summary("owner")).toMatchObject({
    monthlyLimitUsd: 15.25,
    version: 2,
  });
});
