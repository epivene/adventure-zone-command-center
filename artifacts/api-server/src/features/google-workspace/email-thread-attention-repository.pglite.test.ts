import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { ensureEmailThreadAttentionSchema } from "../../db/email-thread-attention-schema";
import { EmailThreadAttentionRepository } from "./email-thread-attention-repository";
it("migrates twice and preserves account boundaries, unknown year and revision history", async () => {
  const db = new PGlite();
  try {
    await ensureEmailThreadAttentionSchema(db);
    await ensureEmailThreadAttentionSchema(db);
    const repo = new EmailThreadAttentionRepository(db);
    const p = {
      id: randomUUID(),
      ownerId: "owner",
      connectorId: null,
      gmailConnectionId: randomUUID(),
      threadId: "t1",
      latestMessageId: "m1",
      profileId: randomUUID(),
      eventYear: null,
      state: "needs_your_reply" as const,
      reason: "Question received",
      dueAt: null,
      followupId: null,
      expectedRevision: null,
      sourceFingerprint: "source",
      expiresAt: "2026-10-01T20:15:00Z",
      subject: "Fair question",
    };
    const first = await db.transaction((tx) => repo.commit(tx, p, "owner"));
    expect(first.eventYear).toBeNull();
    expect((await repo.read(p.gmailConnectionId, "t1"))?.state).toBe(
      "needs_your_reply",
    );
    await expect(
      db.transaction((tx) => repo.commit(tx, p, "owner")),
    ).rejects.toThrow("EMAIL_ATTENTION_STALE");
    expect(
      (await db.query("SELECT * FROM email_thread_attention_audit")).rows,
    ).toHaveLength(1);
    const second = await db.transaction((tx) =>
      repo.commit(
        tx,
        {
          ...p,
          expectedRevision: first.revision,
          state: "waiting_for_their_reply",
        },
        "owner",
      ),
    );
    expect(second.id).toBe(first.id);
    expect(second.revision).not.toBe(first.revision);
    await db.transaction((tx) =>
      repo.commit(tx, { ...p, gmailConnectionId: randomUUID() }, "owner"),
    );
    expect(
      (await db.query("SELECT * FROM email_thread_attention")).rows,
    ).toHaveLength(2);
    expect(
      (await db.query("SELECT * FROM email_thread_attention_audit")).rows,
    ).toHaveLength(3);
  } finally {
    await db.close();
  }
});
