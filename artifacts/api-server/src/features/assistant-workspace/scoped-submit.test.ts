import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { RunStore } from "./run-store";
import { emptySelection } from "./contracts";
import { submitScopedMessage } from "./scoped-submit";
it("persists scope for later turns and does not revert it on an old retry", async () => {
  const db = new PGlite();
  try {
    await ensureAssistantWorkspaceSchema(db);
    await db.exec(
      "CREATE TABLE organizations(id uuid primary key); INSERT INTO organizations VALUES ('11111111-1111-4111-8111-111111111111')",
    );
    const store = new ConversationStore(db),
      runs = new RunStore(db);
    const c = await store.create("owner", "Profile conversation");
    const scope = {
      ...emptySelection(),
      organizationIds: ["11111111-1111-4111-8111-111111111111"],
    };
    const input = {
      actor: { id: "owner", role: "owner" as const, connectionId: null },
      conversationId: c.id,
      requestKey: "first",
      selection: scope,
      grants: [],
    };
    const first = await db.transaction((tx) =>
      submitScopedMessage(tx, input, "What next?", []),
    );
    expect((await store.get("owner", c.id))?.selection).toEqual(scope);
    const claimed = await runs.claim("worker");
    await runs.finish("owner", first.id, claimed!.leaseToken, "succeeded");
    await db.transaction((tx) =>
      submitScopedMessage(
        tx,
        { ...input, requestKey: "general", selection: emptySelection() },
        "General question",
        [],
      ),
    );
    expect((await store.get("owner", c.id))?.selection).toEqual(
      emptySelection(),
    );
    expect(
      (
        await db.transaction((tx) =>
          submitScopedMessage(tx, input, "What next?", []),
        )
      ).id,
    ).toBe(first.id);
    expect((await store.get("owner", c.id))?.selection).toEqual(
      emptySelection(),
    );
    expect((await runs.get("owner", first.id))?.input.selection).toEqual(scope);
  } finally {
    await db.close();
  }
});
