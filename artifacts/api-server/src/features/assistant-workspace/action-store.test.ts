import { beforeEach, afterEach, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { ActionStore, recoveryMode } from "./action-store";
import type { ActionIntent } from "./contracts";
let db: PGlite, actions: ActionStore, intent: ActionIntent;
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  const c = new ConversationStore(db);
  const conversation = await c.create("a", "Review");
  const m = await c.append("a", conversation.id, "u1", {
    role: "user",
    text: "Save this note",
  });
  intent = {
    id: randomUUID(),
    actorId: "a",
    conversationId: conversation.id,
    kind: "add_profile_note",
    targetId: randomUUID(),
    expectedRevision: null,
    connectionId: null,
    arguments: { body: "Confirmed" },
    sourceMessageId: m.id,
  };
  actions = new ActionStore(db);
});
afterEach(async () => {
  await db.close();
});
it("requires reconciliation after possible external mutation", () => {
  expect(recoveryMode("provider_started")).toBe("reconcile");
  expect(recoveryMode("uncertain")).toBe("reconcile");
  expect(recoveryMode("succeeded")).toBe("return_receipt");
});
it("deduplicates an action derived from the same user request", async () => {
  const a = await actions.prepare(intent);
  const b = await actions.prepare({ ...intent, id: randomUUID() });
  expect(b.id).toBe(a.id);
});
it("cannot prepare an action under another actor", async () => {
  await expect(actions.prepare({ ...intent, actorId: "b" })).rejects.toThrow(
    "ASSISTANT_ACTION_NOT_AUTHORIZED",
  );
});
it("fences previous workers after lease recovery", async () => {
  const a = await actions.prepare(intent);
  const first = await actions.claim("a", a.id, "worker1");
  expect(first).not.toBeNull();
  expect(await actions.claim("a", a.id, "worker2")).toBeNull();
  await db.query(
    "update assistant_workspace_actions set lease_expires_at=now()-interval '1 minute'",
  );
  const second = await actions.claim("a", a.id, "worker2");
  expect(second!.leaseToken).toBeGreaterThan(first!.leaseToken);
  await expect(
    actions.checkpoint("a", a.id, first!.leaseToken, "succeeded", {}),
  ).rejects.toThrow("ASSISTANT_LEASE_LOST");
});
it("never reclaims provider_started actions after a crash", async () => {
  const a = await actions.prepare(intent);
  const claim = await actions.claim("a", a.id, "worker1");
  await actions.checkpoint(
    "a",
    a.id,
    claim!.leaseToken,
    "provider_started",
    {},
  );
  await db.query(
    "update assistant_workspace_actions set lease_expires_at=now()-interval '1 minute'",
  );
  expect(await actions.claim("a", a.id, "worker2")).toBeNull();
  expect((await actions.get("a", a.id))?.status).toBe("provider_started");
});
it("retains completed receipts and isolates action reads", async () => {
  const a = await actions.prepare(intent);
  const claim = await actions.claim("a", a.id, "worker1");
  await actions.checkpoint("a", a.id, claim!.leaseToken, "succeeded", {
    recordId: "note-1",
  });
  expect((await actions.get("a", a.id))?.result).toEqual({
    recordId: "note-1",
  });
  expect(await actions.get("b", a.id)).toBeNull();
  expect(await actions.claim("a", a.id, "worker2")).toBeNull();
});
