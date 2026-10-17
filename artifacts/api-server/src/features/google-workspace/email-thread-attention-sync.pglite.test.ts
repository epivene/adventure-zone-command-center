import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../chatgpt-connection/test-database";
import { ensureEmailThreadAttentionSchema } from "../../db/email-thread-attention-schema";
import { EmailThreadAttentionRepository } from "./email-thread-attention-repository";
const source = vi.hoisted(() => ({ value: {} as any }));
vi.mock("./email-thread-attention-source", () => ({
  readAttentionSource: async () => source.value,
}));
import { attentionLabelHandler } from "./email-thread-attention-sync";
it("restores attention for new inbound without archiving and blocks revoked synchronization", async () => {
  const f = await fixture();
  const account = randomUUID();
  try {
    await ensureEmailThreadAttentionSchema(f.db);
    const p = {
      id: randomUUID(),
      ownerId: "owner",
      connectorId: f.principal.connectionId,
      gmailConnectionId: account,
      threadId: "t",
      latestMessageId: "old",
      profileId: f.profileId,
      eventYear: null,
      state: "resolved" as const,
      reason: "Handled",
      subject: "Fair",
      dueAt: null,
      followupId: null,
      expectedRevision: null,
      sourceFingerprint: "old",
      expiresAt: new Date().toISOString(),
    };
    const r = await f.db.transaction((tx) =>
      new EmailThreadAttentionRepository(f.db).commit(tx, p, "owner"),
    );
    await f.db.query(
      "INSERT INTO email_thread_attention_operations VALUES($1,'owner',$2,'key','hash',$3,$4,$5,now())",
      [
        randomUUID(),
        f.principal.connectionId,
        p.id,
        r.id,
        JSON.stringify({ record: r }),
      ],
    );
    const labels = new Set(["INBOX", "profile"]);
    const gmail: any = {
      listLabels: async () => [
        { id: "attention", type: "user", name: "Needs Attention" },
      ],
      getThreadLabelIds: async () => [...labels],
      modifyThreadLabels: async (i: any) => {
        i.addLabelIds.forEach((x: string) => labels.add(x));
        i.removeLabelIds.forEach((x: string) => labels.delete(x));
      },
      modifyMessageLabels: async (i: any) => {
        i.addLabelIds.forEach((x: string) => labels.add(x));
        i.removeLabelIds.forEach((x: string) => labels.delete(x));
      },
    };
    source.value = {
      gmailConnectionId: account,
      threadId: "t",
      latestMessageId: "new",
      latestDirection: "incoming",
      get messageLabels() {
        return [{ id: "new", labelIds: [...labels] }];
      },
    };
    const mutation: any = {
      connectionId: account,
      threadId: "t",
      messageId: "new",
      organizationId: f.profileId,
      operation: "label_inbound_message",
    };
    await attentionLabelHandler(f.db, gmail)(mutation, "profile", []);
    expect(labels.has("INBOX")).toBe(true);
    expect(labels.has("attention")).toBe(true);
    expect(
      (await new EmailThreadAttentionRepository(f.db).read(account, "t"))
        ?.state,
    ).toBe("needs_your_reply");
    expect(
      (await f.db.query("SELECT * FROM email_thread_attention_audit")).rows,
    ).toHaveLength(2);
    await f.db.query(
      "UPDATE chatgpt_connections SET revoked_at=now() WHERE id=$1",
      [f.principal.connectionId],
    );
    await expect(
      attentionLabelHandler(f.db, gmail)(mutation, "profile", []),
    ).rejects.toThrow("AUTHORIZATION_REVOKED");
  } finally {
    await f.db.close();
  }
});
