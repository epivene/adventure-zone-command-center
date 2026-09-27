import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { RunStore } from "./run-store";
import { ProfileTaskStore } from "./profile-task-store";
import { ProfileTaskRunner } from "./profile-task-runner";
import { createProfileTaskTools } from "./profile-task-tools";
import { taskEvidence, loadTaskChangeProof } from "./profile-task-evidence";
import { emptySelection, type Queryable } from "./contracts";
it("rejects wrong-profile and incomplete evidence and binds automatic notes to original source text", async () => {
  const pg = new PGlite(),
    db = pg as Queryable;
  try {
    await ensureAssistantWorkspaceSchema(pg);
    await pg.exec(
      "CREATE TABLE organizations(id uuid PRIMARY KEY,name text,consolidated_into_id uuid)",
    );
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids)
      await db.query("INSERT INTO organizations VALUES($1,'Fair',NULL)", [id]);
    const conversations = new ConversationStore(db),
      runs = new RunStore(db),
      store = new ProfileTaskStore(db);
    const c = await conversations.create("owner", "test");
    const original = await runs.submit(
      {
        actor: { id: "owner", role: "owner", connectionId: null },
        conversationId: c.id,
        requestKey: "original",
        selection: emptySelection(),
        grants: [],
      },
      "Save notes",
    );
    await db.query(
      "UPDATE assistant_workspace_runs SET status='succeeded' WHERE id=$1",
      [original.id],
    );
    let task = await store.create(
      "owner",
      c.id,
      "job",
      {
        profileIds: ids,
        eventYear: 2027,
        objective: "Save notes",
        completionMode: "sourced_notes",
        requestedFields: [],
        taskCapUsd: 1,
      },
      {
        sourceMessageId: original.input.sourceMessageId,
        profileIds: ids,
        allowedFields: [],
        actionKinds: ["add_profile_note"],
      },
    );
    task = await store.command("owner", task.id, task.version, "resume");
    await new ProfileTaskRunner(db, store, "mock").dispatchNextTaskBatch(
      "worker",
    );
    const run = (await runs.claim("worker"))!;
    const ctx = {
      taskId: task.id,
      actor: { id: "owner", role: "owner" as const, connectionId: null },
      conversationId: c.id,
      runId: run.id,
      selection: { ...emptySelection(), organizationIds: ids, eventYear: 2027 },
      grants: [],
      signal: new AbortController().signal,
    };
    const evidence = {
      id: "source-a",
      kind: "web",
      recordId: "https://example.org/fair",
      eventYear: null,
      occurredAt: null,
      retrievedAt: "2026-09-27T00:00:00Z",
      version: null,
      complete: true,
      text: "General office phone: 123; organizer unknown.",
      profileId: ids[0],
      contactRole: "unknown",
      originalEvidenceId: "source-original",
    };
    await db.query(
      "INSERT INTO assistant_profile_task_evidence VALUES($1,$2,$3,$4::jsonb)",
      [task.id, ids[0], evidence.id, JSON.stringify(evidence)],
    );
    await db.query(
      "UPDATE assistant_workspace_runs SET checkpoint=jsonb_set(checkpoint,'{turn}',$2::jsonb) WHERE id=$1",
      [run.id, JSON.stringify({ evidence: [evidence] })],
    );
    const tools = createProfileTaskTools(
      db,
      store,
      async () => {},
      () => true,
    );
    const wrong = await tools.execute(ctx, {
      id: "wrong",
      name: "record_profile_task_outcome",
      arguments: JSON.stringify({
        profileId: ids[1],
        outcome: "completed",
        reason: "done",
        evidenceIds: [evidence.id],
      }),
    });
    expect(wrong.code).toBe("ASSISTANT_EVIDENCE_MISSING");
    expect(await taskEvidence(db, task.id, ids[1], [evidence.id])).toEqual([]);
    const prepared = await tools.execute(ctx, {
      id: "prepare",
      name: "prepare_profile_task_change",
      arguments: JSON.stringify({
        profileId: ids[0],
        kind: "add_profile_note",
        expectedRevision: null,
        values: { body: "Invented organizer Alice" },
        evidenceIds: [evidence.id],
      }),
    });
    expect(prepared.status).toBe("ok");
    const values = (prepared.data as any).values;
    expect(values.body).not.toContain("Alice");
    expect(values.body).toContain("Source year: unverified");
    expect(values.body).toContain(evidence.text);
    const intent = {
      id: randomUUID(),
      actorId: "owner",
      conversationId: c.id,
      sourceMessageId: original.input.sourceMessageId,
      targetId: ids[0],
      kind: "add_profile_note",
      arguments: values,
      expectedRevision: null,
      connectionId: null,
    };
    expect(await loadTaskChangeProof(db, task, intent)).not.toBeNull();
    expect(
      await loadTaskChangeProof(db, task, {
        ...intent,
        arguments: { body: "Invented organizer Alice" },
      }),
    ).toBeNull();
    task = {
      ...task,
      scope: {
        ...task.scope,
        completionMode: "profile_fields",
        eventYear: null,
        requestedFields: ["phone"],
      },
    };
    await db.query(
      "UPDATE assistant_profile_tasks SET scope=$2::jsonb WHERE id=$1",
      [task.id, JSON.stringify(task.scope)],
    );
    for (const phone of ["123", "999"]) {
      await tools.execute(ctx, {
        id: "field-" + phone,
        name: "prepare_profile_task_change",
        arguments: JSON.stringify({
          profileId: ids[0],
          kind: "update_profile",
          expectedRevision: "v1",
          values: { phone },
          evidenceIds: [evidence.id],
        }),
      });
      const proof = await loadTaskChangeProof(db, task, {
        ...intent,
        kind: "update_profile",
        expectedRevision: "v1",
        arguments: { phone },
      });
      expect(!!proof).toBe(phone === "123");
    }
    await db.query(
      "UPDATE assistant_profile_task_evidence SET data=jsonb_set(data,'{complete}','false') WHERE task_id=$1",
      [task.id],
    );
    expect(await loadTaskChangeProof(db, task, intent)).toBeNull();
  } finally {
    await pg.close();
  }
});
