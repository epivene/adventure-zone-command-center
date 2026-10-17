import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  activeConnection,
  ConnectionError,
  inputHash,
  requireConnectionScope,
  transaction,
  type ConnectionDatabase,
  type ConnectionPrincipal,
  type MutationKey,
  type SqlQuery,
} from "./contracts";
import { OperationStore } from "./operation-store";
import {
  insertResearchNote,
  receipt,
  sourceSchema,
  validateSources,
} from "./lead-note-service";
import { mergeSnapshot } from "./profile-merge-snapshot";
import { profileRow, profileSummary } from "./read-service";
import { moveExtraMergeReferences } from "./profile-merge-references";

export const mergeInputSchema = z
  .object({
    primaryId: z.string().uuid(),
    duplicateIds: z.array(z.string().uuid()).min(1).max(5),
    reason: z.string().trim().min(1).max(2000),
    sources: z.array(sourceSchema).min(1).max(20),
  })
  .strict()
  .refine(
    (v) =>
      !v.duplicateIds.includes(v.primaryId) &&
      new Set(v.duplicateIds).size === v.duplicateIds.length,
    "Select distinct duplicate profiles and a separate surviving profile.",
  );
export const chatMergeInputSchema = z
  .object({
    proposalId: z.string().uuid(),
    expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    primaryId: z.string().uuid(),
    duplicateIds: z.array(z.string().uuid()).min(1).max(5),
    authorization: z
      .object({
        source: z.literal("current_owner_message"),
        instruction: z.string().trim().min(1).max(4000),
        confirmedSameEvent: z.literal(true),
      })
      .strict(),
  })
  .strict();

type MergeExecutor = (
  tx: SqlQuery,
  primaryId: string,
  duplicateIds: string[],
) => Promise<void>;
export class ProfileMergeService {
  private operations: OperationStore;
  constructor(
    private db: ConnectionDatabase,
    private execute?: MergeExecutor,
  ) {
    this.operations = new OperationStore(db);
  }
  async preview(
    p: ConnectionPrincipal,
    key: MutationKey,
    raw: z.input<typeof mergeInputSchema>,
  ) {
    requireConnectionScope(p, "crm:update");
    const parsed = mergeInputSchema.safeParse(raw);
    if (!parsed.success) throw new ConnectionError("CONNECTION_INVALID_MERGE");
    const input = {
      ...parsed.data,
      primaryId: parsed.data.primaryId.toLowerCase(),
      duplicateIds: parsed.data.duplicateIds
        .map((id) => id.toLowerCase())
        .sort(),
      sources: validateSources(parsed.data.sources),
    };
    if (
      input.duplicateIds.includes(input.primaryId) ||
      new Set(input.duplicateIds).size !== input.duplicateIds.length
    )
      throw new ConnectionError("CONNECTION_INVALID_MERGE");
    return this.operations.perform(
      p,
      "preview_profile_merge",
      key,
      input,
      async (tx) => {
        const snapshot = await mergeSnapshot(
          tx,
          input.primaryId,
          input.duplicateIds,
        );
        const id = randomUUID();
        const content = {
          kind: "profile_merge" as const,
          id,
          connectionId: p.connectionId,
          profileId: input.primaryId,
          profileName: snapshot.primary.name,
          ...input,
          ...snapshot,
        };
        const contentHash = inputHash(content);
        await tx.query(
          "INSERT INTO chatgpt_update_proposals(id,connection_id,profile_id,content,content_hash,revision) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id,
            p.connectionId,
            input.primaryId,
            JSON.stringify(content),
            contentHash,
            snapshot.fingerprint,
          ],
        );
        const reviewUrl = `/settings/chatgpt-connection?proposal=${id}`;
        return receipt(tx, id, reviewUrl, snapshot.fingerprint, {
          ...content,
          contentHash,
          reviewUrl,
        });
      },
    );
  }
  private validate(row: any) {
    if (row.content?.kind !== "profile_merge")
      throw new ConnectionError("CONNECTION_WRONG_PROPOSAL_TYPE", 409);
    if (
      inputHash(row.content) !== row.content_hash ||
      row.content.profileId !== row.profile_id ||
      row.content.primaryId !== row.profile_id ||
      row.content.connectionId !== row.connection_id ||
      row.content.fingerprint !== row.revision
    )
      throw new ConnectionError("CONNECTION_STALE_PROPOSAL", 409);
    return row.content;
  }
  private async revalidate(tx: SqlQuery, row: any) {
    const content = this.validate(row);
    const current = await mergeSnapshot(
      tx,
      content.primaryId,
      content.duplicateIds,
      true,
    );
    if (current.fingerprint !== content.fingerprint)
      throw new ConnectionError(
        "CONNECTION_STALE_MERGE",
        409,
        "Profiles or linked records changed. Prepare a fresh merge preview.",
      );
    if (current.blockers.length)
      throw new ConnectionError(
        "CONNECTION_MERGE_BLOCKED",
        409,
        current.blockers.join(" "),
      );
    return content;
  }
  async approve(
    ownerId: string,
    proposalId: string,
    expectedHash: string,
    confirmedSameEvent: boolean,
  ) {
    if (confirmedSameEvent !== true)
      throw new ConnectionError("CONNECTION_MERGE_CONFIRMATION_REQUIRED", 400);
    return transaction(this.db, async (tx) => {
      const link = (
        await tx.query(
          "SELECT c.* FROM chatgpt_connections c JOIN chatgpt_update_proposals p ON p.connection_id=c.id WHERE p.id=$1 AND c.owner_id=$2",
          [proposalId, ownerId],
        )
      ).rows[0];
      if (!link) throw new ConnectionError("CONNECTION_ACCESS_DENIED", 403);
      await activeConnection(
        tx,
        {
          ownerId,
          connectionId: link.id,
          clientId: link.client_id,
          scopes: ["crm:update"],
        },
        true,
      );
      const row = (
        await tx.query(
          "SELECT * FROM chatgpt_update_proposals WHERE id=$1 FOR UPDATE",
          [proposalId],
        )
      ).rows[0];
      if (
        !row ||
        row.consumed_at ||
        row.approved_at ||
        row.content_hash !== expectedHash
      )
        throw new ConnectionError("CONNECTION_STALE_PROPOSAL", 409);
      await this.revalidate(tx, row);
      const approvalId = randomUUID();
      await tx.query(
        "UPDATE chatgpt_update_proposals SET approval_id=$2,approved_at=now(),approval_expires_at=now()+interval '15 minutes' WHERE id=$1",
        [proposalId, approvalId],
      );
      return { proposalId, approvalId, expiresInSeconds: 900 };
    });
  }
  async apply(
    p: ConnectionPrincipal,
    key: MutationKey,
    input: { proposalId: string; approvalId: string },
  ) {
    requireConnectionScope(p, "crm:update");
    return this.operations.perform(
      p,
      "apply_approved_profile_merge",
      key,
      input,
      async (tx) => {
        const row = (
          await tx.query(
            "SELECT *,approval_expires_at>now() AS unexpired FROM chatgpt_update_proposals WHERE id=$1 AND connection_id=$2 FOR UPDATE",
            [input.proposalId, p.connectionId],
          )
        ).rows[0];
        if (
          !row ||
          row.approval_id !== input.approvalId ||
          !row.approved_at ||
          !row.unexpired ||
          row.consumed_at
        )
          throw new ConnectionError("CONNECTION_APPROVAL_REQUIRED", 403);
        const content = await this.revalidate(tx, row);
        return this.executeValidated(tx, row, content);
      },
    );
  }
  async applyChatAuthorized(
    p: ConnectionPrincipal,
    key: MutationKey,
    raw: z.input<typeof chatMergeInputSchema>,
  ) {
    requireConnectionScope(p, "crm:update");
    const parsed = chatMergeInputSchema.safeParse(raw);
    if (!parsed.success)
      throw new ConnectionError("CONNECTION_MERGE_CONFIRMATION_REQUIRED", 400);
    const input = {
      ...parsed.data,
      primaryId: parsed.data.primaryId.toLowerCase(),
      duplicateIds: parsed.data.duplicateIds
        .map((id) => id.toLowerCase())
        .sort(),
    };
    return this.operations.perform(
      p,
      "apply_chat_authorized_profile_merge",
      key,
      input,
      async (tx) => {
        const row = (
          await tx.query(
            "SELECT *,created_at>now()-interval '15 minutes' AS fresh FROM chatgpt_update_proposals WHERE id=$1 AND connection_id=$2 FOR UPDATE",
            [input.proposalId, p.connectionId],
          )
        ).rows[0];
        if (
          !row ||
          row.consumed_at ||
          !row.fresh ||
          row.content_hash !== input.expectedContentHash
        )
          throw new ConnectionError("CONNECTION_STALE_PROPOSAL", 409);
        const content = await this.revalidate(tx, row);
        if (
          content.primaryId !== input.primaryId ||
          JSON.stringify([...content.duplicateIds].sort()) !==
            JSON.stringify(input.duplicateIds)
        )
          throw new ConnectionError(
            "CONNECTION_MERGE_CONFIRMATION_REQUIRED",
            409,
          );
        // Connector attestation of the owner's current message, not an independently
        // authenticated chat transcript. Never accept background/source-text consent.
        const authorization = {
          ...input.authorization,
          ownerId: p.ownerId,
          connectionId: p.connectionId,
          proposalId: row.id,
          contentHash: row.content_hash,
          primaryId: input.primaryId,
          duplicateIds: input.duplicateIds,
        };
        return this.executeValidated(tx, row, content, authorization);
      },
    );
  }
  private async executeValidated(
    tx: SqlQuery,
    row: any,
    content: any,
    authorization?: Record<string, unknown>,
  ) {
    // Keep source identities and saved owner edits attached to the live profile.
    await tx.query(
      "UPDATE chatgpt_lead_identities SET profile_id=$1 WHERE profile_id=ANY($2::uuid[])",
      [content.primaryId, content.duplicateIds],
    );
    await tx.query(
      `UPDATE chatgpt_external_drafts SET content=jsonb_set(content,'{organizationId}',to_jsonb($1::text)),revision=gen_random_uuid(),updated_at=clock_timestamp()
        WHERE content->>'organizationId'=ANY($2::text[])`,
      [content.primaryId, content.duplicateIds],
    );
    const execute =
      this.execute ??
      (await import("./profile-merge-executor")).executeProfileMerge;
    await moveExtraMergeReferences(
      tx,
      content.primaryId,
      content.duplicateIds,
      content.references.map((r: { table: string }) => r.table),
    );
    await execute(tx, content.primaryId, content.duplicateIds);
    await tx.query(
      "UPDATE organizations SET updated_at=clock_timestamp() WHERE id=$1",
      [content.primaryId],
    );
    await insertResearchNote(
      tx,
      content.primaryId,
      "Duplicate profiles merged",
      JSON.stringify({
        reason: content.reason,
        proposalId: row.id,
        primaryId: content.primaryId,
        originalProfiles: [content.primary, ...content.duplicates],
        policy: content.policy,
        ...(authorization ? { authorization } : {}),
      }),
      content.sources,
    );
    await tx.query(
      "UPDATE chatgpt_update_proposals SET consumed_at=now() WHERE id=$1",
      [row.id],
    );
    const profile = profileSummary(await profileRow(tx, content.primaryId));
    return receipt(tx, profile.id, profile.href, profile.revision, {
      primaryId: profile.id,
      mergedProfileIds: content.duplicateIds,
      profile,
      proposalId: row.id,
      ...(authorization ? { authorization } : {}),
    });
  }
}
