import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../chatgpt-connection/test-database";
import { ensureEmailThreadAttentionSchema } from "../../db/email-thread-attention-schema";
import { EmailThreadAttentionService } from "./email-thread-attention-service";
it("binds previews to source, account and owner, rejects stale decisions and replays once", async () => {
  const f = await fixture();
  const account = randomUUID();
  let latest = "m1";
  let calls = 0;
  let now = new Date("2026-10-01T20:00:00Z");
  try {
    await ensureEmailThreadAttentionSchema(f.db);
    await f.db.exec(
      "CREATE TABLE google_workspace_validation_mappings(connection_id uuid,thread_id text,organization_id uuid);",
    );
    const source = async () => ({
      gmailConnectionId: account,
      threadId: "t1",
      latestMessageId: latest,
      sourceFingerprint: latest,
      subject: "Question",
      from: "fair@example.com",
      to: "office@example.com",
      internalDateMs: 1,
      hasAttachments: false,
    });
    const service = new EmailThreadAttentionService(
      f.db,
      {
        source,
        authorize: async () => {},
        assign: async () => {
          calls++;
          return { mutation: { id: "mutation" } } as any;
        },
        sync: async () => ({
          gmailSync: { state: "completed", errorCode: null },
          archiveSync: {
            state: "complete",
            conversationId: "archive",
            errorCode: null,
          },
        }),
      },
      () => now,
    );
    const actor = { ownerId: "owner", connectorId: f.principal.connectionId };
    const input = {
      messageId: "m1",
      profileId: f.profileId,
      eventYear: null,
      state: "needs_your_reply" as const,
      reason: "Question",
      dueAt: null,
      followupId: null,
    };
    const p = await service.preview(actor, input);
    expect(p.subject).toBe("Question");
    expect(p.expiresAt).toBe("2026-10-01T20:15:00.000Z");
    await expect(
      service.apply(
        { ...actor, ownerId: "other" },
        { previewId: p.id, expectedRevision: null, requestKey: "a" },
      ),
    ).rejects.toThrow("EMAIL_ATTENTION_ACCESS");
    await expect(
      service.apply(
        { ...actor, connectorId: randomUUID() },
        { previewId: p.id, expectedRevision: null, requestKey: "a" },
      ),
    ).rejects.toThrow("EMAIL_ATTENTION_ACCESS");
    now = new Date("2026-10-01T20:15:00Z");
    await expect(
      service.apply(actor, {
        previewId: p.id,
        expectedRevision: null,
        requestKey: "a",
      }),
    ).rejects.toThrow("EMAIL_ATTENTION_PREVIEW_EXPIRED");
    now = new Date("2026-10-01T20:00:00Z");
    await expect(
      service.preview(actor, { ...input, profileId: randomUUID() }),
    ).rejects.toThrow("EMAIL_ATTENTION_PROFILE_NOT_FOUND");
    await expect(
      service.preview(actor, { ...input, followupId: randomUUID() }),
    ).rejects.toThrow("EMAIL_ATTENTION_FOLLOWUP_MISMATCH");
    latest = "m2";
    await expect(
      service.apply(actor, {
        previewId: p.id,
        expectedRevision: null,
        requestKey: "a",
      }),
    ).rejects.toThrow("EMAIL_ATTENTION_SOURCE_CHANGED");
    latest = "m1";
    const result = await service.apply(actor, {
      previewId: p.id,
      expectedRevision: null,
      requestKey: "a",
    });
    expect(result.record.state).toBe("needs_your_reply");
    expect(
      await service.apply(actor, {
        previewId: p.id,
        expectedRevision: null,
        requestKey: "a",
      }),
    ).toEqual(result);
    expect(calls).toBe(1);
    expect(
      (
        await service.read(
          { ...actor, connectorId: null },
          { gmailConnectionId: account, threadId: "t1" },
        )
      )?.record.id,
    ).toBe(result.record.id);
    await expect(
      service.apply(actor, {
        previewId: p.id,
        expectedRevision: randomUUID(),
        requestKey: "a",
      }),
    ).rejects.toThrow("EMAIL_ATTENTION_REQUEST_CHANGED");
    await expect(
      service.apply(actor, {
        previewId: p.id,
        expectedRevision: null,
        requestKey: "b",
      }),
    ).rejects.toThrow("EMAIL_ATTENTION_STALE");
    await f.db.query(
      "INSERT INTO google_workspace_validation_mappings VALUES($1,'t1',$2)",
      [account, randomUUID()],
    );
    await expect(service.preview(actor, input)).rejects.toThrow(
      "EMAIL_ATTENTION_PROFILE_CONFLICT",
    );
  } finally {
    await f.db.close();
  }
});
