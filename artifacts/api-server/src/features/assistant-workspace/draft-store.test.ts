import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { DraftStore } from "./draft-store";
const lifecycleDraft = {
  to: ["a@example.test"],
  cc: [],
  subject: "Saved",
  html: "<p>Saved</p>",
  text: "Saved",
  threadId: null,
  attachmentHashes: [],
  attachmentIds: [],
  organizationId: null,
  templateId: null,
  templateVersion: null,
};
it("retains inactive drafts but rejects edits, provider starts and send review changes", async () => {
  const db = new PGlite();
  try {
    await ensureAssistantWorkspaceSchema(db);
    const conversations = new ConversationStore(db),
      drafts = new DraftStore(db);
    const c = await conversations.create("owner", "Read-only draft");
    const draft = await drafts.create("owner", c.id, lifecycleDraft);
    await db.query(
      "INSERT INTO assistant_workspace_send_reviews(draft_id,actor_id,revision,office_snapshot,raw,connection_id,payment_model) VALUES($1,'owner',$2,'{}','raw','connection','administrative')",
      [draft.id, draft.revision],
    );
    const archived = await conversations.setLifecycle(
      "owner",
      c.id,
      c.version,
      "archived",
    );
    expect((await drafts.get("owner", draft.id))?.revision).toBe(
      draft.revision,
    );
    expect(
      (await drafts.create("owner", c.id, lifecycleDraft, draft.id)).id,
    ).toBe(draft.id);
    await expect(drafts.create("owner", c.id, lifecycleDraft)).rejects.toThrow(
      "ASSISTANT_CONVERSATION_INACTIVE",
    );
    await expect(
      drafts.edit("owner", draft.id, draft.revision, {
        subject: "Hidden edit",
      }),
    ).rejects.toThrow("ASSISTANT_CONVERSATION_INACTIVE");
    await expect(
      drafts.claimSave("owner", draft.id, draft.revision, "connection"),
    ).rejects.toThrow("ASSISTANT_CONVERSATION_INACTIVE");
    await expect(
      db.query(
        "UPDATE assistant_workspace_send_reviews SET approved_revision=revision,approved_by='owner',approved_at=now() WHERE draft_id=$1",
        [draft.id],
      ),
    ).rejects.toThrow("ASSISTANT_CONVERSATION_INACTIVE");
    await expect(
      db.query(
        "INSERT INTO assistant_workspace_send_reviews(draft_id,actor_id,revision,office_snapshot,raw,connection_id,payment_model) VALUES($1,'owner',$2,'{}','raw','connection','administrative') ON CONFLICT(draft_id) DO UPDATE SET updated_at=now()",
        [draft.id, draft.revision],
      ),
    ).rejects.toThrow("ASSISTANT_CONVERSATION_INACTIVE");
    // Tracking reconciliation can settle even from a historical conversation.
    await db.query(
      "UPDATE assistant_workspace_send_reviews SET tracking_complete=true WHERE draft_id=$1",
      [draft.id],
    );
    await conversations.setLifecycle("owner", c.id, archived.version, "active");
    await db.query(
      "UPDATE assistant_workspace_send_reviews SET approved_revision=revision,approved_by='owner',approved_at='2026-01-01' WHERE draft_id=$1",
      [draft.id],
    );
    await drafts.claimSave("owner", draft.id, draft.revision, "connection");
    await drafts.saved("owner", draft.id, draft.revision, "gmail-1", "hash");
    await conversations.setLifecycle(
      "owner",
      c.id,
      archived.version + 1,
      "trashed",
    );
    await expect(
      drafts.claimSend("owner", draft.id, draft.revision),
    ).rejects.toThrow("ASSISTANT_CONVERSATION_INACTIVE");
    await expect(
      db.query(
        "UPDATE assistant_workspace_send_reviews SET approved_revision=revision,approved_by='owner',approved_at=now() WHERE draft_id=$1",
        [draft.id],
      ),
    ).rejects.toThrow("ASSISTANT_CONVERSATION_INACTIVE");
    expect((await drafts.get("owner", draft.id))?.gmailDraftId).toBe("gmail-1");
  } finally {
    await db.close();
  }
});
it("requires provider draft work to settle before moving a conversation", async () => {
  const db = new PGlite();
  try {
    await ensureAssistantWorkspaceSchema(db);
    const conversations = new ConversationStore(db),
      drafts = new DraftStore(db);
    for (const status of ["saving", "sending", "uncertain"]) {
      const c = await conversations.create("owner", status);
      const draft = await drafts.create("owner", c.id, lifecycleDraft);
      await db.query(
        "UPDATE assistant_workspace_drafts SET status=$2 WHERE id=$1",
        [draft.id, status],
      );
      await expect(
        conversations.setLifecycle("owner", c.id, c.version, "trashed"),
      ).rejects.toThrow("ASSISTANT_CONVERSATION_BUSY");
      expect((await conversations.get("owner", c.id))?.lifecycle).toBe(
        "active",
      );
    }
  } finally {
    await db.close();
  }
});
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
