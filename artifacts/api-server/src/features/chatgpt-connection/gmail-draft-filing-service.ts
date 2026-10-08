import { z } from "zod";
import { EmailMappingRepairService } from "./email-mapping-repair-service";
import { activeConnection, ConnectionError, inputHash, requireConnectionScope, type ConnectionDatabase, type ConnectionPrincipal, type MutationKey, type SqlQuery } from "./contracts";
import { OperationStore } from "./operation-store";
import { profileRow } from "./read-service";
import { receipt } from "./lead-note-service";
import type { GoogleGmailDraftRaw } from "../google-workspace/google-api-types";

export const draftFilingInput = z.object({ draftId: z.string().trim().min(1).max(200), profileId: z.string().uuid() }).strict();
export const draftFilingApplyInput = draftFilingInput.extend({ expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Metadata = { id: string; threadId: string; labelIds?: string[]; headers: { subject: string; from: string; to: string } };
export type DraftFilingAccess = {
  connectionId: string;
  readDraft(id: string): Promise<GoogleGmailDraftRaw>;
  metadata(id: string): Promise<Metadata>;
};
type Access = () => Promise<DraftFilingAccess>;
export class GmailDraftFilingService {
  private operations: OperationStore;
  readonly mappingRepair: EmailMappingRepairService;
  constructor(private db: ConnectionDatabase, private access: Access = productionAccess(db)) {
    this.operations = new OperationStore(db);
    this.mappingRepair = new EmailMappingRepairService(db, access);
  }
  private async source(tx: SqlQuery, input: z.infer<typeof draftFilingInput>) {
    const profile = await profileRow(tx, input.profileId);
    const access = await this.access();
    const draft = await access.readDraft(input.draftId);
    const metadata = await access.metadata(draft.messageId);
    if (draft.draftId !== input.draftId || metadata.id !== draft.messageId ||
        !draft.threadId || draft.threadId !== metadata.threadId ||
        !metadata.labelIds?.includes("DRAFT") || metadata.labelIds.includes("SENT"))
      throw new ConnectionError("CONNECTION_DRAFT_SOURCE_CHANGED", 409);
    const revision = inputHash({ connectionId: access.connectionId, profileId: input.profileId,
      profileRevision: profile.revision, draftId: draft.draftId, messageId: draft.messageId,
      threadId: draft.threadId, raw: draft.raw });
    return { access, profile, draft, metadata, revision };
  }
  async preview(p: ConnectionPrincipal, raw: z.infer<typeof draftFilingInput>) {
    requireConnectionScope(p, "crm:read");
    await activeConnection(this.db, p);
    return this.previewCurrent(raw);
  }
  // Internal app entry points: callers must enforce the signed-in owner,
  // selected profile and (for writes) the existing ActionExecutor grant.
  async previewCurrent(raw: z.infer<typeof draftFilingInput>) {
    const input = draftFilingInput.parse(raw);
    const s = await this.source(this.db, input);
    return { draftId: s.draft.draftId, messageId: s.draft.messageId, threadId: s.draft.threadId,
      gmailConnectionId: s.access.connectionId, profileId: input.profileId, profileName: s.profile.name,
      subject: s.metadata.headers.subject, from: s.metadata.headers.from, to: s.metadata.headers.to,
      expectedRevision: s.revision, labelIds: s.metadata.labelIds,
      conflicts: await this.conflicts(s.access.connectionId, s.draft.threadId!),
      instruction: "Read the current full Gmail draft and verify the event/profile match before filing. Filing saves only an app profile association; Gmail drafts cannot carry Profiles labels. It does not send, archive Inbox, change attention/follow-ups or certify outreach readiness." };
  }
  async conflicts(connectionId: string, threadId: string, tx: SqlQuery = this.db) {
    return (await tx.query(
      `SELECT m.message_id AS "messageId",m.organization_id::text AS "profileId",o.name AS "profileName",m.updated_at::text AS revision
       FROM google_workspace_validation_mappings m JOIN organizations o ON o.id=m.organization_id
       WHERE m.connection_id=$1 AND m.thread_id=$2 ORDER BY m.organization_id,m.message_id`,
      [connectionId, threadId])).rows;
  }
  async inspect(p: ConnectionPrincipal, input: { gmailConnectionId: string; threadId: string }) {
    requireConnectionScope(p, "crm:read");
    await activeConnection(this.db, p);
    return this.inspectCurrent(input);
  }
  async inspectCurrent(input: { gmailConnectionId: string; threadId: string }) {
    const access = await this.access();
    if (access.connectionId !== input.gmailConnectionId)
      throw new ConnectionError("CONNECTION_DRAFT_SOURCE_CHANGED", 409);
    return { ...input, mappings: await this.conflicts(input.gmailConnectionId, input.threadId),
      instruction: "These are stored profile associations, not proof of the correct event. Compare the full conversation and profiles. For a verified wrong association, use preview_email_mapping_repair and repair_email_profile_mapping with the exact reviewed revision and an identity-based reason. Do not infer a destination from a similar name or merge profiles." };
  }
  async apply(p: ConnectionPrincipal, key: MutationKey, raw: z.infer<typeof draftFilingApplyInput>) {
    requireConnectionScope(p, "email:organize");
    const input = draftFilingApplyInput.parse(raw);
    return this.operations.perform(p, "file_gmail_draft_to_profile", key, input, tx => this.fileCurrent(tx, input));
  }
  async fileCurrent(tx: SqlQuery, raw: z.infer<typeof draftFilingApplyInput>) {
      const input = draftFilingApplyInput.parse(raw);
      // Use the current draft ID, never a cached message ID from before a Gmail edit.
      await profileRow(tx, input.profileId, true);
      const s = await this.source(tx, input);
      if (s.revision !== input.expectedRevision)
        throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
        [s.access.connectionId, s.draft.threadId]);
      const mappings = await this.conflicts(s.access.connectionId, s.draft.threadId!, tx);
      const messageMappings = (await tx.query(
        "SELECT organization_id::text AS \"profileId\" FROM google_workspace_validation_mappings WHERE connection_id=$1 AND message_id=$2",
        [s.access.connectionId, s.draft.messageId])).rows;
      if ([...mappings, ...messageMappings].some(m => m.profileId !== input.profileId))
        throw new ConnectionError("EMAIL_ATTENTION_PROFILE_CONFLICT", 409);
      // Gmail forbids user labels on draft messages. Keep this an app-only
      // association; sent/received mail uses the separate profile-label workflow.
      const verified = await this.source(tx, input);
      if (verified.revision !== input.expectedRevision)
        throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
      const association = await tx.query(
        `INSERT INTO google_workspace_validation_mappings(connection_id,message_id,thread_id,organization_id,contact_id,evidence_codes,created_at,updated_at)
         VALUES($1,$2,$3,$4,NULL,'["owner_authorized_draft_filing"]'::jsonb,now(),now())
         ON CONFLICT(connection_id,message_id) DO UPDATE SET organization_id=EXCLUDED.organization_id,
         thread_id=EXCLUDED.thread_id,evidence_codes=EXCLUDED.evidence_codes,updated_at=now()
         WHERE google_workspace_validation_mappings.organization_id=EXCLUDED.organization_id RETURNING message_id`,
        [verified.access.connectionId, verified.draft.messageId, verified.draft.threadId, input.profileId]);
      if (!association.rows.length) throw new ConnectionError("EMAIL_ATTENTION_PROFILE_CONFLICT", 409);
      return receipt(tx, input.profileId, `/profiles/${input.profileId}`, verified.revision, {
        draftId: input.draftId, messageId: verified.draft.messageId, threadId: verified.draft.threadId,
        profileId: input.profileId, filingLocation: "app", gmailLabelsChanged: false,
        state: "draft_filed", sent: false, archived: false,
        instruction: "Verified app-only draft association. Gmail drafts cannot carry Profiles labels. Recheck after edits; file sent mail separately. This does not approve content or update reply state." });
  }
  async verifyCurrent(raw: z.infer<typeof draftFilingApplyInput>) {
    const input = draftFilingApplyInput.parse(raw);
    const s = await this.source(this.db, input);
    if (s.revision !== input.expectedRevision) throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
    const associations = await this.conflicts(s.access.connectionId, s.draft.threadId!);
    if (!associations.some(m => m.messageId === s.draft.messageId && m.profileId === input.profileId) ||
        associations.some(m => m.profileId !== input.profileId))
      throw new ConnectionError("CONNECTION_DRAFT_FILING_READBACK_FAILED", 409);
    return { draftId: input.draftId, messageId: s.draft.messageId, profileId: input.profileId,
      filingLocation: "app", gmailLabelsChanged: false, state: "draft_filed", sent: false, archived: false };
  }
}
function productionAccess(db: ConnectionDatabase): Access {
  return async () => {
    const { PostgresGoogleConnectionRepository } = await import("../google-workspace/google-connection-repository");
    const connections = new PostgresGoogleConnectionRepository({ pool: db });
    const before = await connections.getCurrent();
    const reader = await connections.createReadClient();
    if (!before || !reader?.getGmailDraftRaw || !reader.getMessageMetadata ||
        (await connections.getCurrent())?.id !== before.id)
      throw new ConnectionError("GOOGLE_WORKSPACE_NOT_CONNECTED", 409);
    return { connectionId: before.id,
      readDraft: id => reader.getGmailDraftRaw!(id), metadata: id => reader.getMessageMetadata!(id) };
  };
}
