import { pool as defaultPool } from "@workspace/db";
import type { GoogleThreadDetail, GoogleWorkspaceReadClient } from "@/features/google-workspace/google-api-types";
import type { BusinessDocumentCandidate } from "./business-document-ingestion";
import type { StoredBusinessDocumentBlob } from "./business-document-types";

export type GmailImportWindow = { after: string; before: string; pageToken?: string | null; maxResults?: number };
export type GmailDocumentInventoryItem = {
  messageId: string;
  threadId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  subject: string;
  bodyText: string;
  originalGmailUrl: string;
  approvedProfileId: string | null;
  exactEmailProfileIds: string[];
  storedBlob: StoredBusinessDocumentBlob | null;
};
type ExistingFileLookup = {
  find(messageId: string, attachmentId: string): Promise<{ profileId: string | null; blob: StoredBusinessDocumentBlob | null }>;
  profilesForEmails?(emails: string[]): Promise<string[]>;
};

function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(new Date(`${value}T00:00:00Z`).valueOf())) throw new Error("GMAIL_IMPORT_WINDOW_INVALID");
  return value.replaceAll("-", "/");
}

export class GoogleGmailDocumentSource {
  constructor(
    private readonly client: Pick<GoogleWorkspaceReadClient, "listMessagePage" | "getMessageMetadata" | "getThreadDetail" | "getAttachment">,
    private readonly existingFiles: ExistingFileLookup,
  ) {}

  async inventoryPage(input: GmailImportWindow) {
    if (!this.client.listMessagePage || !this.client.getMessageMetadata || !this.client.getThreadDetail) throw new Error("GOOGLE_GMAIL_READ_UNAVAILABLE");
    if (input.after >= input.before) throw new Error("GMAIL_IMPORT_WINDOW_INVALID");
    const page = await this.client.listMessagePage({ maxResults: Math.min(250, Math.max(1, input.maxResults ?? 100)), pageToken: input.pageToken, query: `after:${date(input.after)} before:${date(input.before)} has:attachment` });
    const items: GmailDocumentInventoryItem[] = [];
    const threads = new Map<string, GoogleThreadDetail>();
    const profileIdsByThread = new Map<string, string[]>();
    for (const ref of page.messages) {
      const metadata = await this.client.getMessageMetadata(ref.id);
      if (!metadata.hasAttachments) continue;
      let thread = threads.get(metadata.threadId);
      if (!thread) { thread = await this.client.getThreadDetail(metadata.threadId); threads.set(metadata.threadId, thread); }
      if (!profileIdsByThread.has(thread.id)) {
        const emails = [...new Set(thread.messages.flatMap((item) => `${item.from} ${item.to} ${item.cc}`.toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []))];
        profileIdsByThread.set(thread.id, this.existingFiles.profilesForEmails ? await this.existingFiles.profilesForEmails(emails) : []);
      }
      const message = thread.messages.find((candidate) => candidate.id === metadata.id);
      if (!message) continue;
      for (const attachment of message.attachments) {
        const existing = await this.existingFiles.find(message.id, attachment.attachmentId);
        items.push({
          messageId: message.id,
          threadId: thread.id,
          attachmentId: attachment.attachmentId,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          subject: message.subject || thread.subject,
          bodyText: message.bodyText,
          originalGmailUrl: thread.originalGmailUrl,
          approvedProfileId: existing.profileId,
          exactEmailProfileIds: profileIdsByThread.get(thread.id) ?? [],
          storedBlob: existing.blob,
        });
      }
    }
    return { items, nextPageToken: page.nextPageToken };
  }

  async *inventoryHistoricalGmail(input: GmailImportWindow): AsyncGenerator<GmailDocumentInventoryItem> {
    let pageToken = input.pageToken ?? null;
    let yielded = 0;
    do {
      const page = await this.inventoryPage({ ...input, pageToken });
      for (const item of page.items) {
        yield item;
        yielded += 1;
        if (yielded >= 500) return;
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  async candidate(item: GmailDocumentInventoryItem, accountKey: string): Promise<BusinessDocumentCandidate> {
    if (!item.storedBlob && !this.client.getAttachment) throw new Error("GOOGLE_GMAIL_ATTACHMENT_UNAVAILABLE");
    return {
      ...(item.storedBlob ? { storedBlob: item.storedBlob } : { bytes: await this.client.getAttachment!({ messageId: item.messageId, attachmentId: item.attachmentId }) }),
      filename: item.filename,
      mimeType: item.mimeType,
      subject: item.subject,
      bodyText: item.bodyText,
      source: { sourceKind: "gmail", sourceAccountKey: accountKey, externalId: `${item.messageId}:${item.attachmentId}`, originalUrl: item.originalGmailUrl, metadata: { messageId: item.messageId, attachmentId: item.attachmentId, threadId: item.threadId } },
      evidence: { approvedThreadProfileId: item.approvedProfileId, exactEmailProfileIds: item.exactEmailProfileIds, exactEventMatches: [], fuzzyNameMatches: [] },
      actor: "google_gmail_import",
      requireRelationshipReview: true,
    };
  }
}

type QueryPool = { query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
export class PostgresExistingGoogleProfileFileLookup implements ExistingFileLookup {
  constructor(private readonly pool: QueryPool = defaultPool as unknown as QueryPool) {}
  async find(messageId: string, attachmentId: string) {
    const result = await this.pool.query(
      `SELECT organization_id, content_sha256, storage_object_key, size_bytes, mime_type
         FROM google_workspace_profile_files WHERE message_id = $1 AND attachment_id = $2 AND availability = 'available' LIMIT 1`,
      [messageId, attachmentId],
    );
    const row = result.rows[0];
    const checksum = typeof row?.content_sha256 === "string" && /^[0-9a-f]{64}$/.test(row.content_sha256) ? row.content_sha256 : null;
    const key = typeof row?.storage_object_key === "string" ? row.storage_object_key : null;
    return {
      profileId: typeof row?.organization_id === "string" ? row.organization_id : null,
      blob: checksum && key ? { sha256Hex: checksum, storageKey: key, sizeBytes: Number(row?.size_bytes ?? 0), mimeType: typeof row?.mime_type === "string" ? row.mime_type : "application/octet-stream" } : null,
    };
  }
  async profilesForEmails(emails: string[]) {
    if (!emails.length) return [];
    const result = await this.pool.query(
      "SELECT DISTINCT organization_id FROM contacts WHERE organization_id IS NOT NULL AND lower(email) = ANY($1::text[])",
      [emails],
    );
    return result.rows.flatMap((row) => typeof row.organization_id === "string" ? [row.organization_id] : []);
  }
}
