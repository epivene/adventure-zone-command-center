import { beforeEach, afterEach, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { RunStore } from "./run-store";
import { emptySelection } from "./contracts";
import { ProfileTaskStore } from "./profile-task-store";
import { ProfileTaskRunner } from "./profile-task-runner";
let db: PGlite, store: ProfileTaskStore, runner: ProfileTaskRunner, task: any;
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  store = new ProfileTaskStore(db);
  runner = new ProfileTaskRunner(db, store, "test-model");
  const c = await new ConversationStore(db).create("owner", "Batch");
  const runs = new RunStore(db);
  const r = await runs.submit(
    {
      actor: { id: "owner", role: "owner", connectionId: null },
      conversationId: c.id,
      requestKey: "init",
      selection: emptySelection(),
      grants: [],
    },
    "Research profiles",
  );
  await db.query<any>(
    "UPDATE assistant_workspace_runs SET status='succeeded' WHERE id=$1",
    [r.id],
  );
  const ids = Array.from({ length: 120 }, () => randomUUID());
  task = await store.create(
    "owner",
    c.id,
    "job",
    {
      profileIds: ids,
      eventYear: 2027,
      objective: "Research and save notes",
      requestedFields: [],
      taskCapUsd: null,
    },
    {
      sourceMessageId: r.input.sourceMessageId,
      profileIds: ids,
      actionKinds: [],
      allowedFields: [],
    },
  );
  task = await store.command("owner", task.id, task.version, "resume");
});
afterEach(async () => db.close());
it("dispatches at most four items and never overlaps batches", async () => {
  expect(await runner.dispatchNextTaskBatch("w")).toBe(true);
  expect(await runner.dispatchNextTaskBatch("w2")).toBe(false);
  const rows = (
    await db.query<any>("SELECT item_ids FROM assistant_profile_task_runs")
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].item_ids).toHaveLength(4);
  const t = await store.get("owner", task.id);
  expect(t?.items.filter((i) => i.state === "researching")).toHaveLength(4);
});
it("pauses after no progress and retains exact remaining counts", async () => {
  await runner.dispatchNextTaskBatch("w");
  const r = (
    await db.query<any>("SELECT run_id FROM assistant_profile_task_runs")
  ).rows[0];
  await db.query<any>(
    "UPDATE assistant_workspace_runs SET status='partial' WHERE id=$1",
    [r.run_id],
  );
  await runner.reconcileTaskRun(r.run_id);
  const t = await store.get("owner", task.id);
  expect(t?.state).toBe("paused");
  expect(t?.pauseReason).toBe("no_progress");
  expect(t?.counts.remaining).toBe(120);
  expect(await runner.dispatchNextTaskBatch("w")).toBe(false);
});
it("does not dispatch after cancel or on archived conversation", async () => {
  await store.command("owner", task.id, task.version, "cancel");
  expect(await runner.dispatchNextTaskBatch("w")).toBe(false);
});
it("processes 120 persisted item outcomes in 30 distinct batches", async () => {
  const seen = new Set<string>();
  for (let n = 0; n < 30; n++) {
    expect(await runner.dispatchNextTaskBatch("worker")).toBe(true);
    const b = (
      await db.query<any>(
        "SELECT * FROM assistant_profile_task_runs WHERE NOT settled",
      )
    ).rows[0];
    for (const id of b.item_ids) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    await db.query<any>(
      "UPDATE assistant_profile_task_items SET state='needs_review',reason='no_current_contact' WHERE id=ANY($1::uuid[])",
      [b.item_ids],
    );
    await db.query<any>(
      "UPDATE assistant_workspace_runs SET status='succeeded' WHERE id=$1",
      [b.run_id],
    );
    await runner.reconcileTaskRun(b.run_id);
  }
  expect(seen.size).toBe(120);
  expect(await runner.dispatchNextTaskBatch("worker")).toBe(false);
  expect((await store.get("owner", task.id))?.counts).toEqual({
    total: 120,
    completed: 0,
    needsReview: 120,
    failed: 0,
    remaining: 0,
  });
});
it("bounds transient retries to three total attempts before retaining failures", async () => {
  for (let n = 0; n < 3; n++) {
    await runner.dispatchNextTaskBatch("worker");
    const b = (
      await db.query<any>(
        "SELECT * FROM assistant_profile_task_runs WHERE NOT settled",
      )
    ).rows[0];
    await db.query<any>(
      "UPDATE assistant_workspace_runs SET status='failed' WHERE id=$1",
      [b.run_id],
    );
    await runner.reconcileTaskRun(b.run_id);
  }
  const t = await store.get("owner", task.id);
  expect(t?.counts.failed).toBe(4);
  expect(t?.items.slice(0, 4).every((i) => i.attempts === 3)).toBe(true);
});
it("resumes an expired child lease without dispatching a second batch", async () => {
  await runner.dispatchNextTaskBatch("first");
  const runs = new RunStore(db);
  const first = await runs.claim("first");
  await db.query<any>(
    "UPDATE assistant_workspace_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
    [first!.id],
  );
  expect(await runner.dispatchNextTaskBatch("second")).toBe(false);
  const resumed = await runs.claim("second");
  expect(resumed?.id).toBe(first?.id);
  expect(resumed!.leaseToken).toBe(first!.leaseToken + 1);
});
it("blocks dispatch for archived conversations and revoked actors", async () => {
  expect(
    await new ProfileTaskRunner(db, store, "test", []).dispatchNextTaskBatch(
      "w",
    ),
  ).toBe(false);
  await db.query<any>(
    "UPDATE assistant_workspace_conversations SET lifecycle='archived' WHERE id=$1",
    [task.conversationId],
  );
  expect(await runner.dispatchNextTaskBatch("w")).toBe(false);
});
it("discovered task freezes validated IDs and never starts before card confirmation", async () => {
  const { createProfileTaskTools } = await import("./profile-task-tools");
  const source = (
    await db.query<any>(
      "SELECT id FROM assistant_workspace_runs WHERE request_key='init'",
    )
  ).rows[0];
  const tools = createProfileTaskTools(
    db,
    store,
    async (ids) => {
      if (ids.some((id) => !task.scope.profileIds.includes(id)))
        throw Error("ASSISTANT_PROFILE_NOT_FOUND");
    },
    () => true,
  );
  const context = {
    actor: { id: "owner", role: "owner" as const, connectionId: null },
    conversationId: task.conversationId,
    runId: source.id,
    selection: emptySelection(),
    grants: [],
    signal: new AbortController().signal,
  };
  const call = {
    id: "proposal",
    name: "propose_profile_task",
    arguments: JSON.stringify({
      scope: { ...task.scope, profileIds: task.scope.profileIds.slice(0, 2) },
      proposedActions: ["add_profile_note"],
    }),
  };
  const proposed: any = (await tools.execute(context, call)).data;
  expect(proposed.state).toBe("proposed");
  expect(proposed.scope.profileIds).toEqual(task.scope.profileIds.slice(0, 2));
  expect(proposed.authority.actionKinds).toEqual(["add_profile_note"]);
  const invalid = await tools.execute(context, {
    ...call,
    id: "invalid",
    arguments: JSON.stringify({
      scope: { ...task.scope, profileIds: [randomUUID()] },
      proposedActions: [],
    }),
  });
  expect(invalid.code).toBe("ASSISTANT_PROFILE_NOT_FOUND");
});
