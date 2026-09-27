import express from "express";
import request from "supertest";
import { createProfileTaskRouter } from "../../routes/assistant-workspace-tasks";
import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { ProfileTaskStore } from "./profile-task-store";
import { ActionStore } from "./action-store";
import { ActionExecutor } from "./action-executor";
import { emptySelection, type Queryable } from "./contracts";
import { guardTaskMutation, taskChangeId } from "./profile-task-safety";
import { profileTaskView } from "./profile-task-view";
it("gives exact replay the same action ID and revised changes distinct IDs", () => {
  const base = {
    taskId: "t",
    targetId: "p",
    kind: "update_profile",
    expectedRevision: "v1",
    arguments: { phone: "123" },
  };
  expect(taskChangeId(base)).toBe(
    taskChangeId({ ...base, arguments: { phone: "123" } }),
  );
  expect(taskChangeId(base)).not.toBe(
    taskChangeId({ ...base, expectedRevision: "v2" }),
  );
  expect(taskChangeId(base)).not.toBe(
    taskChangeId({ ...base, arguments: { website: "https://example.org" } }),
  );
});
it("retains a deleted profile name and blocks generic task approval after Cancel", async () => {
  const pg = new PGlite(),
    db = pg as Queryable;
  try {
    await ensureAssistantWorkspaceSchema(pg);
    await pg.exec(
      "CREATE TABLE organizations(id uuid PRIMARY KEY,name text,consolidated_into_id uuid)",
    );
    const profile = randomUUID();
    await db.query("INSERT INTO organizations VALUES($1,'Named Fair',NULL)", [
      profile,
    ]);
    const c = await new ConversationStore(db).create("owner", "test"),
      m = await new ConversationStore(db).append("owner", c.id, "source", {
        role: "user",
        text: "Research",
      });
    const store = new ProfileTaskStore(db),
      t = await store.create(
        "owner",
        c.id,
        "job",
        {
          profileIds: [profile],
          eventYear: 2027,
          objective: "Research",
          requestedFields: [],
          taskCapUsd: 1,
        },
        {
          sourceMessageId: m.id,
          actionKinds: [],
          allowedFields: [],
          profileIds: [profile],
        },
      );
    const a = {
      id: randomUUID(),
      actorId: "owner",
      conversationId: c.id,
      sourceMessageId: m.id,
      kind: "add_profile_note",
      targetId: profile,
      arguments: { body: "note" },
      expectedRevision: null,
      connectionId: null,
    };
    await new ActionStore(db).prepare(a);
    await db.query(
      "UPDATE assistant_profile_task_items SET action_ids=$2::jsonb WHERE task_id=$1",
      [t.id, JSON.stringify([a.id])],
    );
    await store.command("owner", t.id, t.version, "cancel");
    await db.query("DELETE FROM organizations WHERE id=$1", [profile]);
    expect(
      (await profileTaskView(db, (await store.get("owner", t.id))!)).items[0]
        .profileName,
    ).toBe("Named Fair");
    const ctx = {
      actor: { id: "owner", role: "owner" as const, connectionId: null },
      conversationId: c.id,
      runId: "ui:approval",
      selection: { ...emptySelection(), organizationIds: [profile] },
      grants: [],
      signal: new AbortController().signal,
    };
    await expect(guardTaskMutation(db, ctx, a, true)).rejects.toThrow(
      "ASSISTANT_TASK_REVIEW_REQUIRED",
    );
    let wrote = false;
    const executor = new ActionExecutor(
      "owner",
      new ActionStore(db),
      {
        add_profile_note: {
          validate: async () => {},
          apply: async () => {
            wrote = true;
            throw Error("should not write");
          },
        },
      },
      undefined,
      (c, a) => guardTaskMutation(db, c, a, true),
    );
    const result = await executor.execute(
      {
        ...ctx,
        grants: [
          {
            actorId: "owner",
            sourceMessageId: m.id,
            actionKind: a.kind,
            targetIds: [profile],
            revision: null,
            connectionId: null,
          },
        ],
      },
      a,
    );
    expect(result.code).toBe("ASSISTANT_TASK_REVIEW_REQUIRED");
    expect(wrote).toBe(false);
  } finally {
    await pg.close();
  }
});
it("keeps a known rolled-back revision conflict explicit rather than uncertain", async () => {
  const pg = new PGlite(),
    db = pg as Queryable;
  try {
    await ensureAssistantWorkspaceSchema(pg);
    const conversations = new ConversationStore(db),
      c = await conversations.create("owner", "test"),
      m = await conversations.append("owner", c.id, "source", {
        role: "user",
        text: "Update",
      }),
      actions = new ActionStore(db);
    const intent = {
      id: randomUUID(),
      actorId: "owner",
      conversationId: c.id,
      sourceMessageId: m.id,
      kind: "update_profile",
      targetId: randomUUID(),
      arguments: { phone: "123" },
      expectedRevision: "old",
      connectionId: null,
    };
    const executor = new ActionExecutor("owner", actions, {
      update_profile: {
        validate: async () => {},
        rollbackErrorCodes: ["ASSISTANT_VERSION_CONFLICT"],
        apply: async () => {
          throw Error("ASSISTANT_VERSION_CONFLICT");
        },
      },
    });
    const out = await executor.execute(
      {
        actor: { id: "owner", role: "owner", connectionId: null },
        conversationId: c.id,
        runId: "ui:test",
        selection: emptySelection(),
        grants: [
          {
            actorId: "owner",
            sourceMessageId: m.id,
            actionKind: "update_profile",
            targetIds: [intent.targetId],
            revision: "old",
            connectionId: null,
          },
        ],
        signal: new AbortController().signal,
      },
      intent,
    );
    expect(out).toMatchObject({
      status: "blocked",
      code: "ASSISTANT_VERSION_CONFLICT",
    });
    expect((await actions.get("owner", intent.id))?.status).toBe("failed");
  } finally {
    await pg.close();
  }
});

it("keeps a stale approval visible as a named conflict with a retry path", async () => {
  const pg = new PGlite(),
    db = pg as Queryable;
  try {
    await ensureAssistantWorkspaceSchema(pg);
    await pg.exec(
      "CREATE TABLE organizations(id uuid PRIMARY KEY,name text,consolidated_into_id uuid,phone text)",
    );
    const profile = randomUUID();
    await db.query(
      "INSERT INTO organizations VALUES($1,'Fair',NULL,'newer phone')",
      [profile],
    );
    const conversations = new ConversationStore(db),
      store = new ProfileTaskStore(db),
      actions = new ActionStore(db),
      c = await conversations.create("owner", "test"),
      m = await conversations.append("owner", c.id, "original", {
        role: "user",
        text: "Research",
      });
    let task = await store.create(
      "owner",
      c.id,
      "job",
      {
        profileIds: [profile],
        eventYear: null,
        objective: "Fill phone",
        requestedFields: ["phone"],
        taskCapUsd: 1,
      },
      {
        profileIds: [profile],
        sourceMessageId: m.id,
        actionKinds: [],
        allowedFields: [],
      },
    );
    task = await store.command("owner", task.id, task.version, "resume");
    const intent = {
      id: randomUUID(),
      actorId: "owner",
      conversationId: c.id,
      sourceMessageId: m.id,
      kind: "update_profile",
      targetId: profile,
      arguments: { phone: "proposed" },
      expectedRevision: "old",
      connectionId: null,
    };
    await actions.prepare(intent);
    await db.query(
      "UPDATE assistant_profile_task_items SET state='awaiting_review',action_ids=$2::jsonb WHERE task_id=$1",
      [task.id, JSON.stringify([intent.id])],
    );
    const executor = new ActionExecutor(
      "owner",
      actions,
      {
        update_profile: {
          validate: async () => {},
          rollbackErrorCodes: ["ASSISTANT_VERSION_CONFLICT"],
          apply: async () => {
            throw Error("ASSISTANT_VERSION_CONFLICT");
          },
        },
      },
      undefined,
      (c, a) => guardTaskMutation(db, c, a, true),
    );
    const runtime: any = {
      profileTasks: store,
      actions,
      conversations,
      executor,
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
        () => true,
      ),
    );
    const response = await request(app)
      .post(`/tasks/${task.id}/approvals`)
      .send({
        requestKey: "approve",
        expectedVersion: task.version,
        actions: [{ id: intent.id, revision: "old" }],
      });
    expect(response.status).toBe(200);
    expect(response.body.results[0].code).toBe("ASSISTANT_VERSION_CONFLICT");
    task = (await store.get("owner", task.id))!;
    expect(task.items[0].state).toBe("needs_review");
    expect(task.items[0].reason).toBe("revision_changed_retry_to_refresh");
    const view = await profileTaskView(db, task);
    expect(view.changes[0]).toMatchObject({
      profileName: "Fair",
      available: false,
    });
    expect(view.changes[0].conflict).toContain("retry");
    expect(
      (
        await store.command("owner", task.id, task.version, "retry", [
          task.items[0].id,
        ])
      ).items[0].state,
    ).toBe("pending");
    const revised = {
      ...intent,
      expectedRevision: "new",
      id: taskChangeId({
        taskId: task.id,
        targetId: profile,
        kind: intent.kind,
        expectedRevision: "new",
        arguments: intent.arguments,
      }),
    };
    expect((await actions.prepare(revised)).id).not.toBe(intent.id);
  } finally {
    await pg.close();
  }
});

it("approves two distinct notes on the same profile in one review batch", async () => {
  const pg = new PGlite(),
    db = pg as Queryable;
  try {
    await ensureAssistantWorkspaceSchema(pg);
    await pg.exec(
      "CREATE TABLE organizations(id uuid PRIMARY KEY,name text,consolidated_into_id uuid,phone text)",
    );
    const profile = randomUUID();
    await db.query(
      "INSERT INTO organizations VALUES($1,'Fair',NULL,'newer phone')",
      [profile],
    );
    const conversations = new ConversationStore(db),
      store = new ProfileTaskStore(db),
      actions = new ActionStore(db),
      c = await conversations.create("owner", "test"),
      m = await conversations.append("owner", c.id, "original", {
        role: "user",
        text: "Research",
      });
    let task = await store.create(
      "owner",
      c.id,
      "job",
      {
        profileIds: [profile],
        eventYear: null,
        objective: "Fill phone",
        requestedFields: ["phone"],
        taskCapUsd: 1,
      },
      {
        profileIds: [profile],
        sourceMessageId: m.id,
        actionKinds: [],
        allowedFields: [],
      },
    );
    task = await store.command("owner", task.id, task.version, "resume");
    const intent = {
      id: randomUUID(),
      actorId: "owner",
      conversationId: c.id,
      sourceMessageId: m.id,
      kind: "add_profile_note",
      targetId: profile,
      arguments: { body: "First source note" },
      expectedRevision: "old",
      connectionId: null,
    };
    await actions.prepare(intent);
    const second = {
      ...intent,
      id: randomUUID(),
      arguments: { body: "Second source note" },
    };
    await actions.prepare(second);
    await db.query(
      "UPDATE assistant_profile_task_items SET state='awaiting_review',action_ids=$2::jsonb WHERE task_id=$1",
      [task.id, JSON.stringify([intent.id, second.id])],
    );
    const executor = new ActionExecutor(
      "owner",
      actions,
      {
        add_profile_note: {
          validate: async () => {},
          rollbackErrorCodes: ["ASSISTANT_VERSION_CONFLICT"],
          apply: async () => {
            return {
              status: "ok" as const,
              data: {},
              evidence: [],
              code: null,
              receipts: [
                {
                  id: randomUUID(),
                  kind: "note",
                  href: "/",
                  verifiedAt: new Date().toISOString(),
                },
              ],
            };
          },
        },
      },
      undefined,
      (c, a) => guardTaskMutation(db, c, a, true),
    );
    const runtime: any = {
      profileTasks: store,
      actions,
      conversations,
      executor,
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
        () => true,
      ),
    );
    const response = await request(app)
      .post(`/tasks/${task.id}/approvals`)
      .send({
        requestKey: "approve",
        expectedVersion: task.version,
        actions: [
          { id: intent.id, revision: "old" },
          { id: second.id, revision: "old" },
        ],
      });
    expect(response.status).toBe(200);
    expect(response.body.results.map((r: any) => r.status)).toEqual([
      "ok",
      "ok",
    ]);
    expect((await store.get("owner", task.id))!.items[0].state).toBe(
      "needs_review",
    );
  } finally {
    await pg.close();
  }
});
