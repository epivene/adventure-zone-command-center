import { loadTaskChangeProof } from "./profile-task-evidence";
import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { PGlite } from "@electric-sql/pglite";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { createProfileTaskRouter } from "../../routes/assistant-workspace-tasks";
import { ConversationStore } from "./conversation-store";
import { RunStore } from "./run-store";
import { ActionStore } from "./action-store";
import { ActionExecutor } from "./action-executor";
import { ProfileTaskStore } from "./profile-task-store";
import { ProfileTaskRunner } from "./profile-task-runner";
import {
  createProfileTaskTools,
  profileTaskSavedContext,
} from "./profile-task-tools";
import { createToolRegistry } from "./tool-registry";
import { createWorkspaceWorker } from "./worker";
import {
  emptySelection,
  type Queryable,
  type ActionIntent,
  type ToolResult,
} from "./contracts";
import { grantTaskAction } from "./profile-task-policy";
it("runs 120 profiles through routes and worker, retaining missing evidence and recovering a saved note after a crash", async () => {
  const pg = new PGlite(),
    db = pg as Queryable;
  try {
    await ensureAssistantWorkspaceSchema(pg);
    await pg.exec(
      "CREATE TABLE organizations(id uuid PRIMARY KEY,name text,consolidated_into_id uuid);CREATE TABLE test_notes(id uuid PRIMARY KEY,profile_id uuid UNIQUE,body text);",
    );
    const ids: string[] = Array.from({ length: 120 }, () => randomUUID());
    for (const [n, id] of ids.entries())
      await db.query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
        id,
        `Event ${n}`,
      ]);
    const conversations = new ConversationStore(db),
      runs = new RunStore(db),
      actions = new ActionStore(db),
      store = new ProfileTaskStore(db),
      runner = new ProfileTaskRunner(db, store, "mock");
    const conversation = await conversations.create("owner", "Profile work");
    const original = await runs.submit(
      {
        actor: { id: "owner", role: "owner", connectionId: null },
        conversationId: conversation.id,
        requestKey: "source",
        selection: emptySelection(),
        grants: [],
        model: "mock",
      },
      "Research and save sourced notes for these 120 profiles",
    );
    await db.query(
      "UPDATE assistant_workspace_runs SET status='succeeded' WHERE id=$1",
      [original.id],
    );
    let enabled = true;
    const runtime: any = {
      profileTasks: store,
      validateTaskProfiles: async (values: string[]) => {
        expect(values).toEqual(ids);
      },
      taskView: async (t: any) => t,
      worker: { tick: async () => {} },
    };
    const app = express();
    app.use(express.json());
    app.use((_q, s, n) => {
      s.locals.actorId = "owner";
      n();
    });
    app.use(
      createProfileTaskRouter(
        () => runtime,
        () => enabled,
      ),
    );
    app.use((e: Error, _q: any, s: any, _n: any) =>
      s.status(400).json({ code: e.message }),
    );
    const created = await request(app)
      .post("/tasks")
      .send({
        conversationId: conversation.id,
        sourceMessageId: original.input.sourceMessageId,
        requestKey: "job",
        scope: {
          profileIds: ids,
          eventYear: 2027,
          objective: "Research and save sourced notes",
          completionMode: "sourced_notes",
          requestedFields: [],
          taskCapUsd: 1,
        },
        explicitActions: ["add_profile_note"],
      });
    expect(created.status).toBe(201);
    let task = created.body;
    const resume = {
      requestKey: "resume",
      expectedVersion: task.version,
      command: "resume",
    };
    expect(
      (await request(app).post(`/tasks/${task.id}/commands`).send(resume))
        .status,
    ).toBe(200);
    expect(
      (await request(app).post(`/tasks/${task.id}/commands`).send(resume))
        .status,
    ).toBe(200);
    const intents = new Map<string, ActionIntent>();
    let writes = 0,
      crashed = false;
    const adapter = {
      validate: async () => {},
      apply: async (_c: any, intent: ActionIntent): Promise<ToolResult> => {
        writes++;
        await db.query(
          "INSERT INTO test_notes(id,profile_id,body) VALUES($1,$2,$3)",
          [intent.id, intent.targetId, "Sourced note"],
        );
        const output: ToolResult = {
          status: "ok",
          data: null,
          evidence: [],
          receipts: [
            {
              kind: "add_profile_note",
              id: intent.id,
              href: "/profiles/" + intent.targetId,
              verifiedAt: new Date().toISOString(),
            },
          ],
          code: null,
        };
        await db.query(
          "INSERT INTO assistant_workspace_mutation_results(action_id,actor_id,result) VALUES($1,$2,$3::jsonb)",
          [intent.id, "owner", JSON.stringify(output)],
        );
        if (!crashed) {
          crashed = true;
          throw Error("crash after commit");
        }
        return output;
      },
      reconcile: async (_c: any, intent: ActionIntent) =>
        (
          await db.query(
            "SELECT result FROM assistant_workspace_mutation_results WHERE action_id=$1",
            [intent.id],
          )
        ).rows[0].result,
    };
    const executor = new ActionExecutor(
      "owner",
      actions,
      { add_profile_note: adapter },
      async (c, intent) => {
        const t = (await store.get("owner", c.taskId!))!,
          item = t.items.find((i) => i.profileId === intent.targetId)!;
        await db.query(
          "UPDATE assistant_profile_task_items SET action_ids=$2::jsonb WHERE id=$1",
          [item.id, JSON.stringify([intent.id])],
        );
        return grantTaskAction(
          t,
          item,
          intent,
          null,
          undefined,
          await loadTaskChangeProof(db, t, intent),
        );
      },
    );
    const evidenceByProfile = new Map<string, string[]>(),
      valuesByProfile = new Map<string, any>();
    const taskTools = createProfileTaskTools(
      db,
      store,
      async () => {},
      () => enabled,
      async (c) => ({
        status: "ok",
        data: null,
        evidence: [
          {
            id: c.selection.organizationIds[0],
            kind: "web",
            recordId: "https://example.org/" + c.selection.organizationIds[0],
            eventYear: null,
            occurredAt: null,
            retrievedAt: new Date().toISOString(),
            version: null,
            complete: true,
            text: "Verified source with an unverified event year.",
          },
        ],
        receipts: [],
        code: null,
      }),
    );
    const tools = createToolRegistry([
      {
        definitions: taskTools.definitions,
        execute: async (c, call) => {
          const output = await taskTools.execute(c, call),
            args = JSON.parse(call.arguments);
          if (call.name === "research_profile_task")
            evidenceByProfile.set(
              args.profileId,
              output.evidence.map((e) => e.id),
            );
          if (
            call.name === "prepare_profile_task_change" &&
            output.status === "ok"
          )
            valuesByProfile.set(args.profileId, (output.data as any).values);
          return output;
        },
      },
      {
        definitions: () => [
          {
            type: "function",
            name: "add_profile_note",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: true,
            },
          },
        ],
        execute: async (c, call) => {
          const { profileId } = JSON.parse(call.arguments),
            run = (await runs.get("owner", c.runId))!;
          const intent = intents.get(profileId) ?? {
            id: randomUUID(),
            actorId: "owner",
            conversationId: c.conversationId,
            kind: "add_profile_note",
            targetId: profileId,
            expectedRevision: null,
            connectionId: null,
            arguments: valuesByProfile.get(profileId),
            sourceMessageId: run.input.sourceMessageId,
          };
          intents.set(profileId, intent);
          return executor.execute(c, intent);
        },
      },
    ]);
    const rounds = new Map<string, number>();
    const worker = createWorkspaceWorker({
      runs,
      conversations,
      tools,
      allowedActorIds: ["owner"],
      maxSteps: 6,
      maxTokens: 100000,
      evidence: async () => [],
      taskContext: (c) => profileTaskSavedContext(db, c, store),
      profileTasks: {
        enabled: () => enabled,
        dispatchNextTaskBatch: runner.dispatchNextTaskBatch.bind(runner),
        reconcileTaskRun: runner.reconcileTaskRun.bind(runner),
        check: runner.check.bind(runner),
      },
      model: {
        next: async (input) => {
          const key = input.spendingScope!.runId,
            n = rounds.get(key) ?? 0;
          rounds.set(key, n + 1);
          expect(input.state.organizationIds.length).toBeLessThanOrEqual(4);
          const profiles = input.state.organizationIds;
          const calls =
            n === 0
              ? profiles
                  .filter((id) => ids.indexOf(id) < 80)
                  .map((id) => ({
                    id: "research-" + id,
                    name: "research_profile_task",
                    arguments: JSON.stringify({
                      profileId: id,
                      query: "Find source notes",
                    }),
                  }))
              : n === 1
                ? profiles
                    .filter((id) => ids.indexOf(id) < 80)
                    .map((id) => ({
                      id: "prepare-" + id,
                      name: "prepare_profile_task_change",
                      arguments: JSON.stringify({
                        profileId: id,
                        kind: "add_profile_note",
                        expectedRevision: null,
                        values: {},
                        evidenceIds: evidenceByProfile.get(id),
                      }),
                    }))
                : n === 2
                  ? profiles
                      .filter((id) => ids.indexOf(id) < 80)
                      .map((id) => ({
                        id: "note-" + id,
                        name: "add_profile_note",
                        arguments: JSON.stringify({ profileId: id }),
                      }))
                  : n === 3
                    ? profiles.map((id) => ({
                        id: "outcome-" + id,
                        name: "record_profile_task_outcome",
                        arguments: JSON.stringify({
                          profileId: id,
                          outcome:
                            ids.indexOf(id) < 80 ? "completed" : "needs_review",
                          reason: "No current source available",
                          evidenceIds: evidenceByProfile.get(id) ?? [],
                        }),
                      }))
                    : [];
          // Empty research batches still reach the outcome tool in this scripted provider.
          if (n < 2 && !calls.length)
            calls.push(
              ...profiles.map((id) => ({
                id: "unresolved-" + id,
                name: "record_profile_task_outcome",
                arguments: JSON.stringify({
                  profileId: id,
                  outcome: "needs_review",
                  reason: "No current source available",
                  evidenceIds: [],
                }),
              })),
            );
          return {
            text: n >= 3 ? "Batch saved" : "",
            calls,
            providerItems: [],
            inputTokens: 5,
            outputTokens: 5,
          };
        },
      },
    });
    await db.query("DELETE FROM organizations WHERE id=$1", [ids[119]]);
    for (let n = 0; n < 30; n++) await worker.tick();
    task = await store.get("owner", task.id);
    expect(task.counts).toEqual({
      total: 120,
      completed: 80,
      needsReview: 40,
      failed: 0,
      remaining: 0,
    });
    expect(task.state).toBe("completed");
    expect(task.items[119].reason).toBe("profile_unavailable");
    expect(writes).toBe(80);
    const first = intents.get(ids[0])!;
    const recovered = await executor.execute(
      {
        actor: { id: "owner", role: "owner", connectionId: null },
        conversationId: conversation.id,
        runId: "reconcile",
        selection: { ...emptySelection(), organizationIds: [ids[0]] },
        grants: [],
        signal: new AbortController().signal,
      },
      first,
    );
    expect(recovered.status).toBe("ok");
    expect(writes).toBe(80);
    expect(
      (await db.query("SELECT COUNT(*)::int AS n FROM test_notes")).rows[0].n,
    ).toBe(80);
    enabled = false;
    expect((await request(app).get(`/tasks/${task.id}`)).status).toBe(404);
    expect((await store.get("owner", task.id))?.counts.total).toBe(120);
  } finally {
    await pg.close();
  }
}, 30000);
