import { it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { operationsAdapters } from "./operations-actions";
import { ActionExecutor } from "./action-executor";
import { ActionStore } from "./action-store";
import { ConversationStore } from "./conversation-store";
import { emptySelection } from "./contracts";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
let db: PGlite, s: any;
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  await db.exec(
    `CREATE TABLE organizations(id uuid PRIMARY KEY,consolidated_into_id uuid);CREATE TABLE organization_contacts(organization_id uuid,contact_id uuid,active boolean);CREATE TABLE office_accounts(id uuid PRIMARY KEY,display_name text,role text,enabled boolean,updated_at timestamptz DEFAULT now());CREATE TABLE office_tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),office_account_id uuid,task_type text,title text,instructions text,organization_id uuid,contact_id uuid,status text DEFAULT 'todo',needs_help boolean DEFAULT false,coordinator_note text,owner_sort_order bigint,due_at timestamptz,created_by text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),completed_at timestamptz);CREATE TABLE audit_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entity_type text,entity_id uuid,action text,"before" jsonb,"after" jsonb,reverses_entry_id uuid,created_at timestamptz DEFAULT now());`,
  );
  const org = randomUUID(),
    contact = randomUUID(),
    account = randomUUID();
  await db.query("INSERT INTO organizations VALUES($1,NULL)", [org]);
  await db.query("INSERT INTO organization_contacts VALUES($1,$2,true)", [
    org,
    contact,
  ]);
  const a = (
    await db.query<any>(
      "INSERT INTO office_accounts(id,display_name,role,enabled) VALUES($1,'Coordinator','office_coordinator',true) RETURNING *",
      [account],
    )
  ).rows[0];
  const c = await new ConversationStore(db).create("owner", "Office"),
    m = await new ConversationStore(db).append("owner", c.id, "task", {
      role: "user",
      text: "Prepare contact verification",
    });
  const intent = {
    id: randomUUID(),
    actorId: "owner",
    conversationId: c.id,
    sourceMessageId: m.id,
    kind: "create_office_task",
    targetId: account,
    expectedRevision: new Date(a.updated_at).toISOString(),
    connectionId: null,
    arguments: {
      taskType: "contact_verification",
      title: "Verify fair contact",
      instructions: "For 2027 planning",
      organizationId: org,
      contactId: contact,
      dueAt: "2026-10-01T12:00:00Z",
    },
  };
  const context = {
    actor: { id: "owner", role: "owner", connectionId: null },
    conversationId: c.id,
    runId: randomUUID(),
    selection: { ...emptySelection(), organizationIds: [org], eventYear: 2027 },
    signal: new AbortController().signal,
    grants: [],
  };
  s = {
    context,
    intent,
    org,
    contact,
    account,
    executor: new ActionExecutor(
      "owner",
      new ActionStore(db),
      operationsAdapters(drizzle(db), db),
    ),
  };
  grant(intent);
}, 30000);
afterEach(async () => {
  await db.close();
});
function grant(i: any) {
  s.context.grants = [
    {
      actorId: "owner",
      sourceMessageId: i.sourceMessageId,
      actionKind: i.kind,
      targetIds: [i.targetId],
      revision: i.expectedRevision,
      connectionId: null,
    },
  ];
}
it("creates one reviewed shared office task and preserves due date and coordinator notes on a partial edit", async () => {
  const r = await s.executor.execute(s.context, s.intent);
  expect(r.status).toBe("ok");
  expect((await s.executor.execute(s.context, s.intent)).receipts).toEqual(
    r.receipts,
  );
  expect((await db.query("SELECT * FROM office_tasks")).rows).toHaveLength(1);
  const task = (
    await db.query<any>(
      "UPDATE office_tasks SET coordinator_note='Call after lunch' RETURNING *",
    )
  ).rows[0];
  const edit = {
    ...s.intent,
    id: randomUUID(),
    kind: "update_office_task",
    targetId: task.id,
    expectedRevision: new Date(task.updated_at).toISOString(),
    arguments: { title: "Verify primary contact" },
  };
  grant(edit);
  expect((await s.executor.execute(s.context, edit)).status).toBe("ok");
  const saved = (await db.query<any>("SELECT * FROM office_tasks")).rows[0];
  expect(saved.coordinator_note).toBe("Call after lunch");
  expect(new Date(saved.due_at).toISOString()).toBe("2026-10-01T12:00:00.000Z");
});
it("rejects disabled accounts, moved contacts and stale revisions", async () => {
  await db.exec("UPDATE office_accounts SET enabled=false");
  await expect(s.executor.execute(s.context, s.intent)).rejects.toThrow(
    "ASSISTANT_COORDINATOR_UNAVAILABLE",
  );
  await db.exec(
    "UPDATE office_accounts SET enabled=true; UPDATE organization_contacts SET active=false",
  );
  await expect(s.executor.execute(s.context, s.intent)).rejects.toThrow(
    "ASSISTANT_CONTACT_MISMATCH",
  );
  await db.exec("UPDATE organization_contacts SET active=true");
  const stale = { ...s.intent, id: randomUUID(), expectedRevision: "stale" };
  grant(stale);
  await expect(s.executor.execute(s.context, stale)).rejects.toThrow(
    "ASSISTANT_VERSION_CONFLICT",
  );
  expect((await db.query("SELECT * FROM office_tasks")).rows).toHaveLength(0);
});
it("rolls back task, audit and receipt together", async () => {
  await db.exec(
    "ALTER TABLE audit_entries ADD CONSTRAINT reject_task CHECK(entity_type<>'office_task')",
  );
  expect((await s.executor.execute(s.context, s.intent)).status).toBe(
    "uncertain",
  );
  expect((await db.query("SELECT * FROM office_tasks")).rows).toHaveLength(0);
  expect(
    (await db.query("SELECT * FROM assistant_workspace_mutation_results")).rows,
  ).toHaveLength(0);
});
it("validates retained contact membership when a partial edit changes the profile", async () => {
  const created = await s.executor.execute(s.context, s.intent);
  expect(created.status).toBe("ok");
  const other = randomUUID();
  await db.query("INSERT INTO organizations VALUES($1,NULL)", [other]);
  s.context.selection.organizationIds.push(other);
  const task = (await db.query<any>("SELECT * FROM office_tasks")).rows[0],
    edit = {
      ...s.intent,
      id: randomUUID(),
      kind: "update_office_task",
      targetId: task.id,
      expectedRevision: new Date(task.updated_at).toISOString(),
      arguments: { organizationId: other },
    };
  grant(edit);
  await expect(s.executor.execute(s.context, edit)).rejects.toThrow(
    "ASSISTANT_CONTACT_MISMATCH",
  );
  expect(
    (await db.query<any>("SELECT * FROM office_tasks")).rows[0].organization_id,
  ).toBe(s.org);
});
