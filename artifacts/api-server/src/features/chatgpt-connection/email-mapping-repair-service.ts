import { z } from "zod";
import { randomUUID } from "node:crypto";
import { activeConnection, ConnectionError, inputHash, requireConnectionScope, type ConnectionDatabase, type ConnectionPrincipal, type MutationKey, type SqlQuery } from "./contracts";
import { OperationStore } from "./operation-store";
import { profileRow } from "./read-service";
import { receipt } from "./lead-note-service";
import type { DraftFilingAccess } from "./gmail-draft-filing-service";

export const mappingRepairInput = z.object({
  gmailConnectionId: z.string().uuid(),
  threadId: z.string().trim().min(1).max(200),
  messageId: z.string().trim().min(1).max(200),
  profileId: z.string().uuid(),
}).strict();
export const mappingRepairApplyInput = mappingRepairInput.extend({
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(1).max(2000),
}).strict();
type Input = z.infer<typeof mappingRepairInput>;

// Correct only existing app associations. Normal filing remains responsible
// for Gmail labels, current reply state and customer-history synchronization.
export class EmailMappingRepairService {
  private operations: OperationStore;
  constructor(private db: ConnectionDatabase, private access: () => Promise<DraftFilingAccess>) {
    this.operations = new OperationStore(db);
  }
  private async source(input: Input) {
    const access = await this.access();
    if (access.connectionId !== input.gmailConnectionId)
      throw new ConnectionError("CONNECTION_EMAIL_REPAIR_SOURCE_CHANGED", 409);
    const message = await access.metadata(input.messageId);
    if (message.id !== input.messageId || message.threadId !== input.threadId)
      throw new ConnectionError("CONNECTION_EMAIL_REPAIR_SOURCE_CHANGED", 409);
    return message;
  }
  private async snapshot(tx: SqlQuery, input: Input, lock = false) {
    const target = await profileRow(tx, input.profileId, lock);
    const mappings = (await tx.query(
      `SELECT *,created_at::text AS created_version,updated_at::text AS revision
       FROM google_workspace_validation_mappings
       WHERE connection_id=$1 AND (thread_id=$2 OR message_id=$3)
       ORDER BY message_id LIMIT 501${lock ? " FOR UPDATE" : ""}`,
      [input.gmailConnectionId, input.threadId, input.messageId])).rows;
    if (mappings.length > 500) throw new ConnectionError("CONNECTION_EMAIL_REPAIR_TOO_LARGE", 409);
    if (!mappings.length) throw new ConnectionError("CONNECTION_EMAIL_REPAIR_NO_MAPPING", 409);
    // A stored cross-thread message needs separate investigation; never touch
    // a second thread without reviewing its complete mapping snapshot.
    if (mappings.some(m => m.thread_id !== input.threadId))
      throw new ConnectionError("CONNECTION_EMAIL_REPAIR_CROSS_THREAD", 409);
    const reviews = (await tx.query(
      "SELECT * FROM google_workspace_validation_review_items WHERE connection_id=$1 AND thread_id=$2 ORDER BY message_id LIMIT 501" + (lock ? " FOR UPDATE" : ""),
      [input.gmailConnectionId, input.threadId])).rows;
    if (reviews.length > 500) throw new ConnectionError("CONNECTION_EMAIL_REPAIR_TOO_LARGE", 409);
    const attention = (await tx.query(
      "SELECT * FROM email_thread_attention WHERE gmail_connection_id=$1 AND thread_id=$2" + (lock ? " FOR UPDATE" : ""),
      [input.gmailConnectionId, input.threadId])).rows[0] ?? null;
    const intent = (await tx.query(
      "SELECT * FROM google_workspace_gmail_thread_intents WHERE connection_id=$1 AND thread_id=$2" + (lock ? " FOR UPDATE" : ""),
      [input.gmailConnectionId, input.threadId])).rows[0] ?? null;
    const profiles = (await tx.query(
      "SELECT id,name,city,region,website,updated_at::text AS revision FROM organizations WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[...new Set(mappings.map(m => m.organization_id))]])).rows;
    const blocker = attention && attention.profile_id !== input.profileId && attention.followup_id
      ? "CONNECTION_EMAIL_REPAIR_LINKED_FOLLOWUP" : null;
    return { target, mappings, reviews, attention, intent, profiles, blocker };
  }
  private revision(input: Input, message: unknown, s: Awaited<ReturnType<EmailMappingRepairService["snapshot"]>>) {
    return inputHash({ input, message, target: { id: s.target.id, revision: s.target.revision },
      mappings: s.mappings, reviews: s.reviews, attention: s.attention, intent: s.intent, profiles: s.profiles });
  }
  async preview(p: ConnectionPrincipal, raw: Input) {
    requireConnectionScope(p, "crm:read");
    await activeConnection(this.db, p);
    const input = mappingRepairInput.parse(raw);
    const message = await this.source(input);
    const s = await this.snapshot(this.db, input);
    return { ...input, profileName: s.target.name, message, mappings: s.mappings, priorProfiles: s.profiles,
      reviews: s.reviews, attention: s.attention, expectedRevision: this.revision(input, message, s), blocker: s.blocker,
      instruction: "Read the full Gmail conversation and source/destination profiles before correcting a verified wrong association. Similar names alone are insufficient. This preview does not choose the correct profile. Repair preserves prior mappings in audit, does not merge/delete profiles, send email or change Gmail labels. Then preview/apply normal filing and verify both Gmail and history sync. A linked follow-up on a different profile blocks repair; resolve it explicitly first." };
  }
  async apply(p: ConnectionPrincipal, key: MutationKey, raw: z.infer<typeof mappingRepairApplyInput>) {
    requireConnectionScope(p, "email:organize");
    const input = mappingRepairApplyInput.parse(raw);
    const selection = mappingRepairInput.parse({
      gmailConnectionId: input.gmailConnectionId, threadId: input.threadId,
      messageId: input.messageId, profileId: input.profileId });
    return this.operations.perform(p, "repair_email_profile_mapping", key, input, async tx => {
      const current = (await tx.query(
        "SELECT id FROM google_workspace_connections WHERE (role='workspace' OR role IS NULL) AND status='connected' ORDER BY updated_at DESC,id DESC LIMIT 1 FOR UPDATE")).rows[0];
      if (current?.id !== input.gmailConnectionId)
        throw new ConnectionError("CONNECTION_EMAIL_REPAIR_SOURCE_CHANGED", 409);
      // Matches the lock used by native assignments and attention filing.
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [input.gmailConnectionId, input.threadId]);
      const s = await this.snapshot(tx, selection, true);
      const message = await this.source(selection);
      if (this.revision(selection, message, s) !== input.expectedRevision)
        throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
      if (s.blocker) throw new ConnectionError(s.blocker, 409);

      const changed = Boolean(s.mappings.some(m => m.organization_id !== input.profileId)
        || s.reviews.some(r => r.review_state === "resolved" && r.resolved_organization_id && r.resolved_organization_id !== input.profileId)
        || (s.attention && s.attention.profile_id !== input.profileId)
        || (s.intent && s.intent.organization_id !== input.profileId));
      if (changed) {
        // Invalidate outstanding label/history jobs for the old destination.
        // Never enqueue a Gmail mutation here (especially for DRAFT sources).
        await tx.query(
          "UPDATE google_workspace_gmail_thread_intents SET generation=generation+1,current_mutation_id=NULL,organization_id=$3,intent_kind='assign',updated_at=now() WHERE connection_id=$1 AND thread_id=$2",
          [input.gmailConnectionId, input.threadId, input.profileId]);
        await tx.query(
          "UPDATE google_workspace_gmail_mutations SET state='permanent_error',last_error_code='GOOGLE_WORKSPACE_ASSIGNMENT_SUPERSEDED',next_attempt_at=NULL,processing_lease_expires_at=NULL,updated_at=now() WHERE connection_id=$1 AND thread_id=$2 AND operation IN ('assign_thread','link_thread','label_inbound_message') AND state IN ('pending','processing','retryable_error')",
          [input.gmailConnectionId, input.threadId]);
        await tx.query(
          `UPDATE google_workspace_validation_mappings SET organization_id=$3,
           contact_id=CASE WHEN organization_id=$3 THEN contact_id ELSE NULL END,
           evidence_codes=coalesce(evidence_codes,'[]'::jsonb)||'["owner_authorized_mapping_repair"]'::jsonb,
           updated_at=clock_timestamp() WHERE connection_id=$1 AND thread_id=$2`,
          [input.gmailConnectionId, input.threadId, input.profileId]);
        // Correct already-resolved review destinations for this exact thread,
        // preserving classification and leaving pending review decisions alone.
        await tx.query(
          "UPDATE google_workspace_validation_review_items SET resolved_organization_id=$3,reviewed_by=$4,reviewed_at=now(),gmail_sync_state='pending',gmail_sync_error_code=NULL,gmail_sync_mutation_id=NULL,updated_at=clock_timestamp() WHERE connection_id=$1 AND thread_id=$2 AND review_state='resolved' AND resolved_organization_id IS NOT NULL AND resolved_organization_id<>$3",
          [input.gmailConnectionId, input.threadId, input.profileId, p.ownerId]);
        if (s.attention && s.attention.profile_id !== input.profileId) {
          const after = (await tx.query(
            "UPDATE email_thread_attention SET profile_id=$3,revision=$4,actor_id=$5,updated_at=clock_timestamp() WHERE gmail_connection_id=$1 AND thread_id=$2 RETURNING *",
            [input.gmailConnectionId, input.threadId, input.profileId, randomUUID(), p.ownerId])).rows[0];
          await tx.query("INSERT INTO email_thread_attention_audit(id,attention_id,actor_id,before_value,after_value) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)",
            [randomUUID(), s.attention.id, p.ownerId, JSON.stringify(s.attention), JSON.stringify(after)]);
        }
      }
      const after = await this.snapshot(tx, selection);
      if (after.mappings.some(m => m.organization_id !== input.profileId)
        || (after.attention && after.attention.profile_id !== input.profileId)
        || after.reviews.some(r => r.review_state === "resolved" && r.resolved_organization_id && r.resolved_organization_id !== input.profileId))
        throw new ConnectionError("CONNECTION_EMAIL_REPAIR_READBACK_FAILED", 409);
      const auditId = randomUUID();
      await tx.query(
        `INSERT INTO audit_entries(entity_type,entity_id,action,"before","after")
         VALUES('email_profile_mapping',$1,'repair',$2::jsonb,$3::jsonb)`,
        [auditId, JSON.stringify({ gmailConnectionId: input.gmailConnectionId, threadId: input.threadId,
          mappings: s.mappings, reviews: s.reviews, attention: s.attention, intent: s.intent }),
        JSON.stringify({ mappings: after.mappings, reviews: after.reviews, attention: after.attention, intent: after.intent,
          actorId: p.ownerId, connectorId: p.connectionId, reason: input.reason })]);
      return receipt(tx, input.profileId, `/profiles/${input.profileId}`,
        this.revision(selection, message, after), {
          state: "mapping_repaired", changed, ...selection, auditId,
          previousProfileIds: [...new Set(s.mappings.map(m => m.organization_id))],
          repairedMessageIds: after.mappings.map(m => m.message_id),
          gmailSync: "not_performed", archiveSync: "not_performed",
          sent: false, profilesMerged: false, profilesDeleted: false,
          instruction: "App mapping read-back verified. Existing reply state/due date preserved. Gmail labels and customer history are not repaired by this receipt. Re-preview normal filing with the current message, attention state and revision, apply, then verify Gmail and history sync separately. Preserve historical archives; do not delete them." });
    });
  }
}
