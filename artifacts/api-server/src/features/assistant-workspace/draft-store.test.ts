import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { DraftStore } from "./draft-store";
it("owns drafts, preserves recipients during edits and rejects stale revisions", async () => {
  const db = new PGlite();
  try {
    await ensureAssistantWorkspaceSchema(db);
    const c = await new ConversationStore(db).create("owner", "Draft");
    const store = new DraftStore(db);
    const draft = await store.create("owner", c.id, {
      to: ["a@example.test"],
      cc: [],
      subject: "Hi",
      html: "<p>Hello</p>",
      threadId: null,
      attachmentHashes: [],
      text: "Hello",
      attachmentIds: [],
      organizationId: null,
      templateId: null,
      templateVersion: null,
    });
    expect(await store.get("other", draft.id)).toBeNull();
    const changed = await store.edit("owner", draft.id, draft.revision, {
      html: "<p>Hi there</p>",
      text: "Hi there",
    });
    expect(changed.content.to).toEqual(["a@example.test"]);
    expect(changed.revision).not.toBe(draft.revision);
    await expect(
      store.edit("owner", draft.id, draft.revision, { subject: "Stale" }),
    ).rejects.toThrow("ASSISTANT_DRAFT_VERSION_CONFLICT");
  } finally {
    await db.close();
  }
});
