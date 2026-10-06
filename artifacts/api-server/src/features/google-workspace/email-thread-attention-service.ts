import { readAttentionList, type AttentionListInput } from "./email-attention-list";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  transaction,
  inputHash,
  type ConnectionDatabase,
  type SqlQuery,
} from "../chatgpt-connection/contracts";
import { EmailThreadAttentionRepository } from "./email-thread-attention-repository";
import type {
  AttentionActor,
  AttentionPreview,
  AttentionRecord,
} from "./email-thread-attention-types";
import type { CommittedProfileAssignment } from "./google-profile-assignment-transaction";
export const attentionInputSchema = z
  .object({
    messageId: z.string().trim().min(1).max(200),
    profileId: z.string().uuid(),
    eventYear: z.number().int().min(2000).max(2200).nullable(),
    state: z.enum(["needs_your_reply", "waiting_for_their_reply", "resolved"]),
    reason: z.string().trim().min(1).max(2000),
    dueAt: z.string().datetime({ offset: true }).nullable().default(null),
    followupId: z.string().uuid().nullable().default(null),
  })
  .strict();
export const attentionApplySchema = z
  .object({
    previewId: z.string().uuid(),
    expectedRevision: z.string().uuid().nullable(),
    requestKey: z.string().trim().min(1).max(200),
  })
  .strict();
export type AttentionSource = {
  gmailConnectionId: string;
  threadId: string;
  latestMessageId: string;
  sourceFingerprint: string;
  subject: string;
  from: string;
  to: string;
  internalDateMs: number | null;
  hasAttachments: boolean;
};
export type AttentionSync = {
  gmailSync: { state: string; errorCode: string | null };
  archiveSync: {
    state: string;
    conversationId: string | null;
    errorCode: string | null;
  };
};
export type AttentionResult = AttentionSync & {
  operationId: string;
  record: AttentionRecord;
  assignment: "committed";
};
type Ports = {
  source(messageId: string): Promise<AttentionSource>;
  authorize(
    actor: AttentionActor,
    write: boolean,
    tx?: SqlQuery,
  ): Promise<void>;
  assign(
    tx: SqlQuery,
    p: AttentionPreview,
    source: AttentionSource,
    actor: AttentionActor,
  ): Promise<CommittedProfileAssignment>;
  sync(
    actor: AttentionActor,
    committed: CommittedProfileAssignment,
    record: AttentionRecord,
    prior: AttentionSync,
  ): Promise<AttentionSync>;
  inspect?(
    record: AttentionRecord,
    committed: CommittedProfileAssignment,
  ): Promise<AttentionSync>;
};
const pending: AttentionSync = {
  gmailSync: { state: "pending", errorCode: null },
  archiveSync: { state: "pending", conversationId: null, errorCode: null },
};
export class EmailThreadAttentionService {
  constructor(
    private db: ConnectionDatabase,
    private ports: Ports,
    private now = () => new Date(),
  ) {}
  private async validate(
    tx: SqlQuery,
    p: Pick<
      AttentionPreview,
      "profileId" | "gmailConnectionId" | "threadId" | "followupId" | "state"
    >,
  ) {
    const target = (
      await tx.query(
        "SELECT id FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL",
        [p.profileId],
      )
    ).rows[0];
    if (!target) throw new Error("EMAIL_ATTENTION_PROFILE_NOT_FOUND");
    const conflicts = await tx.query(
      "SELECT organization_id FROM google_workspace_validation_mappings WHERE connection_id=$1 AND thread_id=$2 AND organization_id<>$3",
      [p.gmailConnectionId, p.threadId, p.profileId],
    );
    if (conflicts.rows.length)
      throw new Error("EMAIL_ATTENTION_PROFILE_CONFLICT");
    if (p.followupId) {
      const f = (
        await tx.query(
          "SELECT * FROM follow_ups WHERE id=$1 AND organization_id=$2",
          [p.followupId, p.profileId],
        )
      ).rows[0];
      if (!f) throw new Error("EMAIL_ATTENTION_FOLLOWUP_MISMATCH");
      if (p.state === "resolved" && !f.completed_at)
        throw new Error("EMAIL_ATTENTION_FOLLOWUP_OPEN");
    }
    if (p.state === "resolved") {
      const prior = await new EmailThreadAttentionRepository(tx).read(
        p.gmailConnectionId,
        p.threadId,
      );
      if (prior?.followupId) {
        const f = (
          await tx.query("SELECT completed_at FROM follow_ups WHERE id=$1", [
            prior.followupId,
          ])
        ).rows[0];
        if (f && !f.completed_at)
          throw new Error("EMAIL_ATTENTION_FOLLOWUP_OPEN");
      }
    }
  }
  async context(
    actor: AttentionActor,
    messageId: string,
  ): Promise<AttentionRecord | null> {
    await this.ports.authorize(actor, false);
    const source = await this.ports.source(messageId);
    return new EmailThreadAttentionRepository(this.db).read(
      source.gmailConnectionId,
      source.threadId,
    );
  }
  async preview(
    actor: AttentionActor,
    raw: z.input<typeof attentionInputSchema>,
  ): Promise<AttentionPreview> {
    const input = attentionInputSchema.parse(raw);
    await this.ports.authorize(actor, false);
    const source = await this.ports.source(input.messageId);
    const prior = await new EmailThreadAttentionRepository(this.db).read(
      source.gmailConnectionId,
      source.threadId,
    );
    const p: AttentionPreview = {
      ...input,
      ...source,
      id: randomUUID(),
      ownerId: actor.ownerId,
      connectorId: actor.connectorId,
      expectedRevision: prior?.revision ?? null,
      expiresAt: new Date(this.now().getTime() + 15 * 60_000).toISOString(),
    };
    await this.validate(this.db, p);
    (p as any).profileName = (
      await this.db.query("SELECT name FROM organizations WHERE id=$1", [
        p.profileId,
      ])
    ).rows[0]?.name;
    await this.db.query(
      "INSERT INTO email_thread_attention_previews(id,owner_id,connector_id,payload,expires_at) VALUES($1,$2,$3,$4,$5)",
      [p.id, p.ownerId, p.connectorId, JSON.stringify(p), p.expiresAt],
    );
    return p;
  }
  async apply(
    actor: AttentionActor,
    raw: z.input<typeof attentionApplySchema>,
  ): Promise<AttentionResult> {
    const input = attentionApplySchema.parse(raw);
    await this.ports.authorize(actor, true);
    const hash = inputHash(input),
      actorKey = actor.connectorId ?? "owner";
    const loaded = (
      await this.db.query(
        "SELECT payload FROM email_thread_attention_previews WHERE id=$1 AND owner_id=$2 AND connector_id IS NOT DISTINCT FROM $3::uuid",
        [input.previewId, actor.ownerId, actor.connectorId],
      )
    ).rows[0];
    if (!loaded) throw new Error("EMAIL_ATTENTION_ACCESS");
    const p = loaded.payload as AttentionPreview;
    const existing = (
      await this.db.query(
        "SELECT * FROM email_thread_attention_operations WHERE owner_id=$1 AND actor_key=$2 AND request_key=$3",
        [actor.ownerId, actorKey, input.requestKey],
      )
    ).rows[0];
    if (existing) {
      if (existing.request_hash !== hash)
        throw new Error("EMAIL_ATTENTION_REQUEST_CHANGED");
      return this.finish(actor, existing);
    }
    if (new Date(p.expiresAt).getTime() <= this.now().getTime())
      throw new Error("EMAIL_ATTENTION_PREVIEW_EXPIRED");
    if (p.expectedRevision !== input.expectedRevision)
      throw new Error("EMAIL_ATTENTION_STALE");
    const source = await this.ports.source(
      (p as any).messageId ?? p.latestMessageId,
    );
    if (
      source.gmailConnectionId !== p.gmailConnectionId ||
      source.threadId !== p.threadId ||
      source.sourceFingerprint !== p.sourceFingerprint
    )
      throw new Error("EMAIL_ATTENTION_SOURCE_CHANGED");
    const op = await transaction(this.db, async (tx) => {
      await this.ports.authorize(actor, true, tx);
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
        [actor.ownerId + actorKey, input.requestKey],
      );
      const replay = (
        await tx.query(
          "SELECT * FROM email_thread_attention_operations WHERE owner_id=$1 AND actor_key=$2 AND request_key=$3",
          [actor.ownerId, actorKey, input.requestKey],
        )
      ).rows[0];
      if (replay) {
        if (replay.request_hash !== hash)
          throw new Error("EMAIL_ATTENTION_REQUEST_CHANGED");
        return replay;
      }
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
        [p.gmailConnectionId, p.threadId],
      );
      await this.validate(tx, p);
      const record = await new EmailThreadAttentionRepository(tx).commit(
        tx,
        p,
        actor.ownerId,
      );
      const committed = await this.ports.assign(tx, p, source, actor);
      const id = randomUUID(),
        result = {
          operationId: id,
          record,
          assignment: "committed" as const,
          ...pending,
          committed,
        };
      await tx.query(
        "INSERT INTO email_thread_attention_operations(id,owner_id,actor_key,request_key,request_hash,preview_id,attention_id,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          actor.ownerId,
          actorKey,
          input.requestKey,
          hash,
          p.id,
          record.id,
          JSON.stringify(result),
        ],
      );
      return { id, result };
    });
    return this.finish(actor, op);
  }
  private async finish(
    actor: AttentionActor,
    op: any,
  ): Promise<AttentionResult> {
    const { committed, ...result } = op.result;
    const current = await new EmailThreadAttentionRepository(this.db).read(
      result.record.gmailConnectionId,
      result.record.threadId,
    );
    if (current?.revision !== result.record.revision)
      return {
        ...result,
        gmailSync: { state: "superseded", errorCode: "EMAIL_ATTENTION_STALE" },
      };
    if (
      result.gmailSync.state === "completed" &&
      result.archiveSync.state === "complete"
    )
      return result;
    await this.ports.authorize(actor, true);
    let sync: AttentionSync;
    try {
      sync = await this.ports.sync(actor, committed, result.record, result);
    } catch {
      sync = {
        gmailSync: {
          state: "retry_required",
          errorCode: "EMAIL_ATTENTION_SYNC_FAILED",
        },
        archiveSync: result.archiveSync,
      };
    }
    const updated = { ...result, ...sync };
    await this.db.query(
      "UPDATE email_thread_attention_operations SET result=$2 WHERE id=$1",
      [op.id, JSON.stringify({ ...updated, committed })],
    );
    return updated;
  }
  async list(actor: AttentionActor, input: AttentionListInput) {
    return readAttentionList(this.db, (a,w) => this.ports.authorize(a,w), actor, input);
  }
  async read(
    actor: AttentionActor,
    input: { gmailConnectionId: string; threadId: string },
  ): Promise<AttentionResult | null> {
    await this.ports.authorize(actor, false);
    const current = await new EmailThreadAttentionRepository(this.db).read(
      input.gmailConnectionId,
      input.threadId,
    );
    if (!current) return null;
    const result = (
      await this.db.query(
        "SELECT result FROM email_thread_attention_operations WHERE owner_id=$1 AND attention_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
        [actor.ownerId, current.id],
      )
    ).rows[0]?.result;
    if (!result) return null;
    const { committed, ...view } = result;
    const sync = this.ports.inspect
      ? await this.ports.inspect(current, committed)
      : current.revision === view.record.revision
        ? { gmailSync: view.gmailSync, archiveSync: view.archiveSync }
        : {
            gmailSync: { state: "pending", errorCode: null },
            archiveSync: {
              state: "pending",
              conversationId: null,
              errorCode: null,
            },
          };
    return { ...view, ...sync, record: current };
  }
}
