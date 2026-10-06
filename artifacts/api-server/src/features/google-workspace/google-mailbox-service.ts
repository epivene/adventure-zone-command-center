import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import { PostgresGoogleProfileAssignmentTransaction } from "./google-profile-assignment-transaction";
import { PostgresGoogleProfileLabelRepository } from "./google-profile-label-repository";
import { PostgresGoogleGmailMutationRepository } from "./google-gmail-mutation-repository";
import { GoogleProfileLabelResolver } from "./google-profile-label-resolver";
import { GoogleProfileLabelSyncService } from "./google-profile-label-sync-service";
import { PostgresGoogleProfileEmailArchiveRepository } from "./google-profile-email-archive-repository";
import { buildGmailRawMessage } from "./google-api-client";

export type MailboxFolder = "inbox" | "sent" | "drafts" | "search";
const folderLabels = { inbox: ["INBOX"], sent: ["SENT"], drafts: ["DRAFT"], search: [] };
export function draftRevision(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
export class GoogleMailboxService {
  constructor(
    private readonly connection = new PostgresGoogleConnectionRepository(),
    private readonly database = pool,
  ) {}

  private async session(expectedId?: string) {
    const account = await this.connection.getCurrent();
    if (!account || account.status === "disconnected") throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    if (account.status !== "connected") throw new Error("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
    if (expectedId && account.id !== expectedId) throw new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
    const client = await this.connection.createReadClient();
    if (!client) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    await this.assertAccount(account.id);
    return { account, client };
  }

  private async assertAccount(id: string) {
    const current = await this.connection.getCurrent();
    if (current?.id !== id || current.status !== "connected") throw new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
  }

  async list(input: { folder: MailboxFolder; query: string; pageToken?: string; connectionId?: string }) {
    const { account, client } = await this.session(input.connectionId);
    if (!client.listMessagePage || !client.getMessageMetadata) throw new Error("GOOGLE_WORKSPACE_MAILBOX_UNAVAILABLE");
    let refs: Array<{ id: string; threadId: string; draftId?: string }> = [];
    let nextPageToken: string | null;
    if (input.folder === "drafts") {
      if (!client.listGmailDrafts) throw new Error("GOOGLE_WORKSPACE_MAILBOX_UNAVAILABLE");
      const page = await client.listGmailDrafts(input.query, input.pageToken);
      refs = page.drafts.map(draft => ({ ...draft.message, draftId: draft.id }));
      nextPageToken = page.nextPageToken;
    } else {
      const page = await client.listMessagePage({
        maxResults: 25, pageToken: input.pageToken, query: input.query,
        labelIds: folderLabels[input.folder],
      });
      refs = page.messages;
      nextPageToken = page.nextPageToken;
    }
    const rows = [];
    let unavailableCount = 0;
    // Bound metadata fan-out. A deleted message does not hide the remaining page.
    for (let offset = 0; offset < refs.length; offset += 5) {
      const results = await Promise.allSettled(refs.slice(offset, offset + 5).map(async ref => ({
        ...await client.getMessageMetadata!(ref.id), draftId: ref.draftId ?? null,
      })));
      for (const result of results) {
        if (result.status === "fulfilled") rows.push(result.value);
        else if (result.reason?.code === "GOOGLE_WORKSPACE_GMAIL_SOURCE_NOT_FOUND" ||
                 result.reason?.message === "GOOGLE_WORKSPACE_GMAIL_SOURCE_NOT_FOUND") unavailableCount++;
        else throw result.reason;
      }
    }
    await this.assertAccount(account.id);
    const ids = [...new Set(rows.map(row => row.threadId))];
    const linked = ids.length ? await this.database.query(
      `SELECT DISTINCT m.thread_id, o.id::text AS organization_id, o.name
         FROM google_workspace_validation_mappings m
         JOIN organizations o ON o.id=m.organization_id
        WHERE m.connection_id=$1 AND m.thread_id=ANY($2::text[])`, [account.id, ids],
    ) : { rows: [] };
    return {
      connectionId: account.id, email: account.email, nextPageToken, unavailableCount,
      messages: rows.map(row => ({ ...row, profiles: linked.rows.filter(link => link.thread_id === row.threadId)
        .map(link => ({ id: String(link.organization_id), name: String(link.name) })) })),
    };
  }

  async thread(threadId: string, connectionId: string) {
    const { client } = await this.session(connectionId);
    if (!client.getThreadDetail) throw new Error("GOOGLE_WORKSPACE_MAILBOX_UNAVAILABLE");
    const linked = await this.database.query(
      `SELECT DISTINCT o.id::text, o.name FROM google_workspace_validation_mappings m
       JOIN organizations o ON o.id=m.organization_id
       WHERE m.connection_id=$1 AND m.thread_id=$2`,
      [connectionId, threadId],
    );
    const organizationId = linked.rows.length === 1 ? String(linked.rows[0].id) : null;
    const archive = new PostgresGoogleProfileEmailArchiveRepository(this.database, connectionId);
    let detail;
    try { detail = await client.getThreadDetail(threadId); }
    catch (error) {
      const saved = organizationId ? await archive.findByProviderThread({ organizationId, gmailThreadId: threadId }) : null;
      if (!saved) throw error;
      await this.assertAccount(connectionId);
      return {
        id: threadId, subject: saved.subject, originalGmailUrl: saved.originalGmailUrl,
        profiles: linked.rows, savedCopy: true, sourceState: "saved_copy_gmail_unavailable",
        lastSyncedAt: saved.lastSyncedAt,
        messages: saved.messages.map(message => ({ ...message, id: message.gmailMessageId })),
      };
    }
    await this.assertAccount(connectionId);
    if (organizationId) {
      await archive.upsertThread({
        organizationId, contactId: null, gmailThreadId: threadId, subject: detail.subject,
        originalGmailUrl: detail.originalGmailUrl, lastSyncedAt: new Date(),
        archiveState: detail.messages.some(message => message.attachments.length) ? "partial" : "complete",
        messages: detail.messages.map(message => ({ ...message, gmailMessageId: message.id, gmailThreadId: threadId })),
      }).catch(() => undefined);
    }
    await this.assertAccount(connectionId);
    return { ...detail, profiles: linked.rows, sourceState: "synced", savedCopy: false };
  }

  async attachment(input: { threadId: string; messageId: string; attachmentId: string; connectionId: string }) {
    const { client } = await this.session(input.connectionId);
    if (!client.getThreadDetail || !client.getAttachment) throw new Error("GOOGLE_WORKSPACE_MAILBOX_UNAVAILABLE");
    const detail = await client.getThreadDetail(input.threadId);
    const attachment = detail.messages.find(message => message.id === input.messageId)?.attachments
      .find(item => item.attachmentId === input.attachmentId);
    if (!attachment) throw new Error("GOOGLE_WORKSPACE_GMAIL_SOURCE_NOT_FOUND");
    const bytes = await client.getAttachment(input);
    await this.assertAccount(input.connectionId);
    return { bytes, filename: attachment.filename, mimeType: attachment.mimeType };
  }

  async profiles(query: string) {
    const result = await this.database.query(
      `SELECT o.id::text, o.name FROM organizations o WHERE o.consolidated_into_id IS NULL
       AND (o.name ILIKE $1 OR o.city ILIKE $1 OR o.region ILIKE $1 OR o.phone ILIKE $1
         OR EXISTS (SELECT 1 FROM organization_contacts oc JOIN contacts c ON c.id=oc.contact_id
          WHERE oc.organization_id=o.id AND oc.active AND
          (concat_ws(' ',c.first_name,c.last_name) ILIKE $1 OR c.email ILIKE $1 OR c.phone ILIKE $1)))
       ORDER BY o.name, o.id LIMIT 30`, [`%${query.replace(/[\\%_]/g, "\\$&")}%`],
    );
    return { profiles: result.rows };
  }

  async link(input: { connectionId: string; threadId: string; messageId: string; organizationId: string; actorId: string; expectedOrganizationId?: string }) {
    const { client } = await this.session(input.connectionId);
    if (!client.getMessageMetadata) throw new Error("GOOGLE_WORKSPACE_MAILBOX_UNAVAILABLE");
    const message = await client.getMessageMetadata(input.messageId);
    if (message.threadId !== input.threadId) throw new Error("GOOGLE_WORKSPACE_GMAIL_SOURCE_NOT_FOUND");
    const tx = await this.database.connect();
    let committed;
    try {
      await tx.query("BEGIN");
      // Same lock order as assignments: connection, then per-thread intent.
      const account = await tx.query("SELECT id FROM google_workspace_connections WHERE id=$1 AND status='connected' AND (role='workspace' OR role IS NULL) FOR UPDATE", [input.connectionId]);
      if (!account.rows.length) throw new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [input.connectionId, input.threadId]);
      const owners = await tx.query(
        `SELECT DISTINCT organization_id::text FROM google_workspace_validation_mappings
         WHERE connection_id=$1 AND thread_id=$2`,
        [input.connectionId, input.threadId],
      );
      const differentOwner = owners.rows.some(row => row.organization_id !== input.organizationId);
      if (differentOwner && (owners.rows.length !== 1 || owners.rows[0].organization_id !== input.expectedOrganizationId)) throw new Error("GOOGLE_WORKSPACE_PROFILE_LINK_CONFLICT");
      if (input.expectedOrganizationId && !owners.rows.some(row => row.organization_id === input.expectedOrganizationId)) throw new Error("GOOGLE_WORKSPACE_PROFILE_LINK_CONFLICT");
      committed = await new PostgresGoogleProfileAssignmentTransaction(this.database, { tx, connectionId: input.connectionId }).assignMatched({
        ...input, now: new Date(), preserveInbox: true, subject: message.headers.subject,
        from: message.headers.from, to: message.headers.to, internalDateMs: message.internalDateMs,
        hasAttachments: message.hasAttachments,
      });
      if (differentOwner) {
        await tx.query("UPDATE google_workspace_validation_mappings SET organization_id=$3,contact_id=NULL,updated_at=now() WHERE connection_id=$1 AND thread_id=$2", [input.connectionId,input.threadId,input.organizationId]);
        await tx.query("UPDATE google_workspace_validation_review_items SET resolved_organization_id=$3,updated_at=now() WHERE connection_id=$1 AND thread_id=$2 AND review_state='resolved'", [input.connectionId,input.threadId,input.organizationId]);
        await tx.query(
          "INSERT INTO google_workspace_audit_events (actor_kind,actor_id,action,target_type,target_id,metadata) VALUES ('owner',$1,'mailbox_profile_changed','gmail_thread',$2,jsonb_build_object('connectionId',$3::text,'previousOrganizationId',$4::text,'organizationId',$5::text))",
          [input.actorId,input.threadId,input.connectionId,input.expectedOrganizationId,input.organizationId],
        );
      }
      await tx.query("COMMIT");
    } catch (error) {
      await tx.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { tx.release(); }
    // The association is durable before optional Gmail label synchronization.
    try {
      await this.assertAccount(input.connectionId);
      const access = await this.connection.createGmailLabelMutationClient();
      if (!access || access.connectionId !== input.connectionId) throw new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
      const labels = new PostgresGoogleProfileLabelRepository(this.database);
      const sync = new GoogleProfileLabelSyncService({
        enabled: true, mutations: new PostgresGoogleGmailMutationRepository(this.database),
        resolver: new GoogleProfileLabelResolver(labels, access.client), labels, gmail: access.client,
      });
      return { linked: true, mutationId: committed.mutation.id, gmailSync: committed.mutation.state === "completed"
        ? await sync.assignThread({ ...input, preserveInbox: true, decisionRevision: "manual-link" })
        : await sync.retry(committed.mutation.id) };
    } catch (error) {
      return { linked: true, mutationId: committed.mutation.id, gmailSync: {
        state: "retryable_error", errorCode: error instanceof Error ? error.message : "GOOGLE_WORKSPACE_GMAIL_MUTATION_FAILED",
      } };
    }
  }

  async archive(threadId: string, connectionId: string) {
    await this.session(connectionId);
    const access = await this.connection.createGmailLabelMutationClient();
    if (!access || access.connectionId !== connectionId) throw new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
    await access.client.modifyThreadLabels({ threadId, addLabelIds: [], removeLabelIds: ["INBOX"] });
    return { archived: true };
  }

  async markRead(threadId: string, connectionId: string, read: boolean) {
    await this.session(connectionId);
    const access = await this.connection.createGmailLabelMutationClient();
    if (!access || access.connectionId !== connectionId) throw new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
    await access.client.modifyThreadLabels({ threadId, addLabelIds: read ? [] : ["UNREAD"], removeLabelIds: read ? ["UNREAD"] : [] });
    return { read };
  }

  async createDraft(input: { connectionId: string; to: string; subject: string; body: string; bodyFormat?: "plain_text" | "html"; threadId?: string }) {
    const { client } = await this.session(input.connectionId);
    if (!client.createGmailDraft) throw new Error("GOOGLE_WORKSPACE_MAILBOX_UNAVAILABLE");
    // New drafts only. Existing MIME and attachments are never replaced by this editor.
    let inReplyTo: string | undefined;
    let references: string | undefined;
    if (input.threadId) {
      if (!client.getThreadDetail || !client.getGmailMessageRaw) throw new Error("GOOGLE_WORKSPACE_MAILBOX_UNAVAILABLE");
      const thread = await client.getThreadDetail(input.threadId);
      const latest = thread.messages.at(-1);
      if (!latest) throw new Error("GOOGLE_WORKSPACE_GMAIL_SOURCE_NOT_FOUND");
      const source = await client.getGmailMessageRaw(latest.id);
      const headers = Buffer.from(source.raw, "base64url").toString("utf8").split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
      inReplyTo = headers.match(/^Message-ID:[ \t]*(.+)$/im)?.[1]?.trim();
      const prior = headers.match(/^References:[ \t]*(.+)$/im)?.[1]?.trim();
      references = [prior, inReplyTo].filter(Boolean).join(" ") || undefined;
    }
    const raw = buildGmailRawMessage({ ...input, inReplyTo, references });
    const draft = await client.createGmailDraft({ raw, threadId: input.threadId });
    await this.assertAccount(input.connectionId);
    return { ...draft, revision: draftRevision(raw) };
  }

  async draft(draftId: string, connectionId: string) {
    const { client } = await this.session(connectionId);
    if (!client.getGmailDraftRaw || !client.getThreadDetail) throw new Error("GOOGLE_WORKSPACE_MAILBOX_UNAVAILABLE");
    const draft = await client.getGmailDraftRaw(draftId);
    const detail = draft.threadId ? await client.getThreadDetail(draft.threadId) : null;
    const attempts = await this.database.query(
      "SELECT state, message_id, thread_id FROM google_workspace_mailbox_sends WHERE connection_id=$1 AND draft_id=$2",
      [connectionId, draftId],
    );
    await this.assertAccount(connectionId);
    const headers = Buffer.from(draft.raw, "base64url").toString("utf8").split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
    const recipient = (name: string) => [...headers.matchAll(new RegExp("^" + name + ":[ \\t]*(.*)$", "gim"))].map(match => match[1].trim()).join(", ");
    return { draftId, messageId: draft.messageId, recipients: { to: recipient("To"), cc: recipient("Cc"), bcc: recipient("Bcc") }, revision: draftRevision(draft.raw), detail, sendState: attempts.rows[0]?.state ?? null };
  }

  async sendDraft(input: { connectionId: string; draftId: string; revision: string }) {
    const { client } = await this.session(input.connectionId);
    if (!client.getGmailDraftRaw) throw new Error("GOOGLE_WORKSPACE_MAILBOX_UNAVAILABLE");
    const access = await this.connection.createGmailDeliveryClient();
    if (!access || access.connectionId !== input.connectionId) throw new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
    const tx = await this.database.connect();
    let attemptStarted = false;
    let deliveryConfirmed = false;
    try {
      // Session lock survives COMMIT; duplicate requests read the durable result.
      await tx.query("SELECT pg_advisory_lock(hashtext($1),hashtext($2))", [input.connectionId, `mailbox-send:${input.draftId}`]);
      const prior = await tx.query(
        "SELECT state, message_id, thread_id FROM google_workspace_mailbox_sends WHERE connection_id=$1 AND draft_id=$2",
        [input.connectionId, input.draftId],
      );
      if (prior.rows[0]?.state === "sent") return {
        state: "sent", messageId: prior.rows[0].message_id, threadId: prior.rows[0].thread_id,
      };
      if (prior.rows.length) throw new Error("GOOGLE_WORKSPACE_GMAIL_SEND_OUTCOME_UNCERTAIN");
      const current = await client.getGmailDraftRaw(input.draftId);
      if (draftRevision(current.raw) !== input.revision) throw new Error("GOOGLE_WORKSPACE_DRAFT_CHANGED");
      await this.assertAccount(input.connectionId);
      await tx.query(
        "INSERT INTO google_workspace_mailbox_sends (connection_id,draft_id,revision,state) VALUES ($1,$2,$3,'sending')",
        [input.connectionId, input.draftId, input.revision],
      );
      attemptStarted = true;
      const sent = await access.client.sendGmailDraft({ draftId: input.draftId,
        // Send exactly the reviewed MIME snapshot, including attachments.
        raw: current.raw, threadId: current.threadId,
        beforeSend: async () => {
          await this.assertAccount(input.connectionId);
          const checked = await client.getGmailDraftRaw!(input.draftId);
          if (draftRevision(checked.raw) !== input.revision) throw new Error("GOOGLE_WORKSPACE_DRAFT_CHANGED");
        },
      });
      deliveryConfirmed = true;
      await tx.query(
        "UPDATE google_workspace_mailbox_sends SET state='sent',message_id=$3,thread_id=$4,updated_at=now() WHERE connection_id=$1 AND draft_id=$2",
        [input.connectionId, input.draftId, sent.messageId, sent.threadId],
      );
      return { state: "sent", ...sent };
    } catch (error) {
      if (attemptStarted) {
        const code = error instanceof Error ? error.message : "";
        const definitelyNotSent = !deliveryConfirmed && [
          "GOOGLE_WORKSPACE_GMAIL_SEND_REJECTED", "GOOGLE_WORKSPACE_DRAFT_CHANGED",
          "GOOGLE_WORKSPACE_CONNECTION_CHANGED", "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
          "GOOGLE_WORKSPACE_OAUTH_TOKEN_REQUEST_FAILED", "GOOGLE_WORKSPACE_OAUTH_RESPONSE_INVALID",
          "GOOGLE_WORKSPACE_GMAIL_SEND_NOT_ATTEMPTED", "OUTREACH_SEND_RECHECK_FAILED",
        ].includes(code);
        if (definitelyNotSent) {
          await tx.query("DELETE FROM google_workspace_mailbox_sends WHERE connection_id=$1 AND draft_id=$2 AND state='sending'", [input.connectionId,input.draftId]);
          throw error;
        }
        await tx.query(
          "UPDATE google_workspace_mailbox_sends SET state='uncertain',updated_at=now() WHERE connection_id=$1 AND draft_id=$2",
          [input.connectionId, input.draftId],
        ).catch(() => undefined);
        throw new Error("GOOGLE_WORKSPACE_GMAIL_SEND_OUTCOME_UNCERTAIN");
      }
      throw error;
    } finally {
      await tx.query("SELECT pg_advisory_unlock(hashtext($1),hashtext($2))", [input.connectionId, `mailbox-send:${input.draftId}`]).catch(() => undefined);
      tx.release();
    }
  }
}
