import { z } from "zod";
import { activeConnection, ConnectionError, inputHash, requireConnectionScope, type ConnectionDatabase, type ConnectionPrincipal, type MutationKey, type SqlQuery } from "./contracts";
import { OperationStore } from "./operation-store";
import { profileRow } from "./read-service";
import { receipt } from "./lead-note-service";
import { GoogleProfileLabelResolver } from "../google-workspace/google-profile-label-resolver";
import { isCurrentProfileLabelPath } from "../google-workspace/google-profile-label-config";
import type { GoogleGmailDraftRaw, GoogleLabelSummary } from "../google-workspace/google-api-types";

export const draftFilingInput = z.object({ draftId: z.string().trim().min(1).max(200), profileId: z.string().uuid() }).strict();
export const draftFilingApplyInput = draftFilingInput.extend({ expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Metadata = { id: string; threadId: string; labelIds?: string[]; headers: { subject: string; from: string; to: string } };
export type DraftFilingAccess = {
  connectionId: string;
  readDraft(id: string): Promise<GoogleGmailDraftRaw>;
  metadata(id: string): Promise<Metadata>;
  labels(): Promise<GoogleLabelSummary[]>;
  resolve(tx: SqlQuery, profileId: string): Promise<{ id: string; name: string }>;
  modify(input: { messageId: string; addLabelIds: string[]; removeLabelIds: string[] }): Promise<void>;
};
type Access = () => Promise<DraftFilingAccess>;
export class GmailDraftFilingService {
  private operations: OperationStore;
  constructor(private db: ConnectionDatabase, private access: Access = productionAccess(db)) {
    this.operations = new OperationStore(db);
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
      instruction: "Read the current full Gmail draft and verify the event/profile match before filing. Filing changes only this unsent draft's profile label. It does not send, archive Inbox, change attention/follow-ups or certify outreach readiness." };
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
      instruction: "These are stored profile associations, not proof of the correct event. Compare the full conversation and profiles. Do not merge or overwrite conflicting destinations automatically." };
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
      if (mappings.some(m => m.profileId !== input.profileId))
        throw new ConnectionError("EMAIL_ATTENTION_PROFILE_CONFLICT", 409);
      const label = await s.access.resolve(tx, input.profileId);
      if (!isCurrentProfileLabelPath(label.name))
        throw new ConnectionError("GOOGLE_WORKSPACE_PROFILE_LABEL_CONFLICT", 409);
      const labels = await s.access.labels();
      const removeLabelIds = labels.filter(l => l.type === "user" && isCurrentProfileLabelPath(l.name) &&
        l.id !== label.id && s.metadata.labelIds!.includes(l.id)).map(l => l.id);
      // Revalidate after resolving the app's mapped label, immediately before the Gmail mutation.
      const fresh = await this.source(tx, input);
      if (fresh.revision !== input.expectedRevision)
        throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
      await fresh.access.modify({ messageId: fresh.draft.messageId, addLabelIds: [label.id], removeLabelIds });
      const verified = await this.source(tx, input);
      if (verified.revision !== input.expectedRevision || !verified.metadata.labelIds!.includes(label.id) ||
          removeLabelIds.some(id => verified.metadata.labelIds!.includes(id)))
        throw new ConnectionError("CONNECTION_DRAFT_FILING_READBACK_FAILED", 409);
      await tx.query(
        `INSERT INTO google_workspace_validation_mappings(connection_id,message_id,thread_id,organization_id,contact_id,evidence_codes,created_at,updated_at)
         VALUES($1,$2,$3,$4,NULL,'["owner_authorized_draft_filing"]'::jsonb,now(),now())
         ON CONFLICT(connection_id,message_id) DO UPDATE SET organization_id=EXCLUDED.organization_id,
         thread_id=EXCLUDED.thread_id,evidence_codes=EXCLUDED.evidence_codes,updated_at=now()`,
        [verified.access.connectionId, verified.draft.messageId, verified.draft.threadId, input.profileId]);
      return receipt(tx, input.profileId, `/profiles/${input.profileId}`, verified.revision, {
        draftId: input.draftId, messageId: verified.draft.messageId, threadId: verified.draft.threadId,
        profileId: input.profileId, gmailLabelId: label.id, gmailLabelName: label.name,
        state: "draft_filed", sent: false, archived: false,
        instruction: "Verified label receipt at filing time; read the current draft again after any Gmail edit. This does not mark its content ready or update customer-reply state." });
  }
  async verifyCurrent(raw: z.infer<typeof draftFilingApplyInput>) {
    const input = draftFilingApplyInput.parse(raw);
    const s = await this.source(this.db, input);
    if (s.revision !== input.expectedRevision) throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
    const mapping = (await this.db.query(
      "SELECT gmail_label_id,gmail_label_name FROM google_workspace_profile_labels WHERE connection_id=$1 AND organization_id=$2 AND state='active'",
      [s.access.connectionId, input.profileId])).rows[0];
    const associations = await this.conflicts(s.access.connectionId, s.draft.threadId!);
    const actualLabels = await s.access.labels();
    if (!mapping || !isCurrentProfileLabelPath(mapping.gmail_label_name) ||
        !s.metadata.labelIds!.includes(mapping.gmail_label_id) ||
        !actualLabels.some(l => l.id === mapping.gmail_label_id && isCurrentProfileLabelPath(l.name)) ||
        !associations.some(m => m.messageId === s.draft.messageId && m.profileId === input.profileId) ||
        associations.some(m => m.profileId !== input.profileId))
      throw new ConnectionError("CONNECTION_DRAFT_FILING_READBACK_FAILED", 409);
    return { draftId: input.draftId, messageId: s.draft.messageId, profileId: input.profileId,
      gmailLabelId: mapping.gmail_label_id, state: "draft_filed", sent: false, archived: false };
  }
}
function productionAccess(db: ConnectionDatabase): Access {
  return async () => {
    const [{ PostgresGoogleConnectionRepository }, { PostgresGoogleProfileLabelRepository }] = await Promise.all([
      import("../google-workspace/google-connection-repository"),
      import("../google-workspace/google-profile-label-repository"),
    ]);
    const connections = new PostgresGoogleConnectionRepository({ pool: db });
    const before = await connections.getCurrent();
    const reader = await connections.createReadClient();
    const writer = await connections.createGmailLabelMutationClient();
    if (!before || !reader?.getGmailDraftRaw || !reader.getMessageMetadata || !writer ||
        writer.connectionId !== before.id || (await connections.getCurrent())?.id !== before.id)
      throw new ConnectionError("GOOGLE_WORKSPACE_NOT_CONNECTED", 409);
    return { connectionId: before.id,
      readDraft: id => reader.getGmailDraftRaw!(id), metadata: id => reader.getMessageMetadata!(id),
      labels: () => writer.client.listLabels(), modify: input => writer.client.modifyMessageLabels(input),
      resolve: async (tx, organizationId) => {
        const resolver = new GoogleProfileLabelResolver(new PostgresGoogleProfileLabelRepository(tx), writer.client);
        const result = await resolver.resolve({ connectionId: before.id, organizationId });
        if (result.status !== "resolved") throw new ConnectionError(result.code, 409);
        return { id: result.mapping.gmailLabelId, name: result.mapping.gmailLabelName };
      } };
  };
}
