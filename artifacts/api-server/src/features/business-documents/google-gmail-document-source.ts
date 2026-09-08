import { pool as defaultPool } from "@workspace/db";
import type { GoogleThreadDetail, GoogleWorkspaceReadClient } from "@/features/google-workspace/google-api-types";
import type { BusinessDocumentCandidate } from "./business-document-ingestion";
import type { StoredBusinessDocumentBlob } from "./business-document-types";

export type GmailImportWindow = { after: string; before: string; pageToken?: string | null; maxResults?: number };
export type GmailDocumentInventoryItem = {
  messageId: string;
  internalDateMs: number;
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
    private readonly client: Pick<GoogleWorkspaceReadClient, "listMessagePage" | "getThreadDetail" | "getAttachment">,
    private readonly existingFiles: ExistingFileLookup,
  ) {}

  async inventoryPage(input: GmailImportWindow, options: { enrich?: boolean } = {}) {
    if (!this.client.listMessagePage || !this.client.getThreadDetail) throw new Error("GOOGLE_GMAIL_READ_UNAVAILABLE");
    if (input.after >= input.before) throw new Error("GMAIL_IMPORT_WINDOW_INVALID");
    const page = await this.client.listMessagePage({ maxResults: Math.min(250, Math.max(1, input.maxResults ?? 100)), pageToken: input.pageToken, query: `after:${date(input.after)} before:${date(input.before)} has:attachment` });
    const items: GmailDocumentInventoryItem[] = [];
    const enrich = options.enrich !== false;
    const threads = new Map<string, GoogleThreadDetail>();
    const profileIdsByThread = new Map<string, string[]>();
    for (const ref of page.messages) {
      let thread = threads.get(ref.threadId);
      if (!thread) { thread = await this.client.getThreadDetail(ref.threadId); threads.set(ref.threadId, thread); }
      if (enrich && !profileIdsByThread.has(thread.id)) {
        const emails = [...new Set(thread.messages.flatMap((item) => `${item.from} ${item.to} ${item.cc}`.toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []))];
        profileIdsByThread.set(thread.id, this.existingFiles.profilesForEmails ? await this.existingFiles.profilesForEmails(emails) : []);
      }
      const message = thread.messages.find((candidate) => candidate.id === ref.id);
      if (!message) continue;
      for (const attachment of message.attachments) {
        const existing = enrich
          ? await this.existingFiles.find(message.id, attachment.attachmentId)
          : { profileId: null, blob: null };
        items.push({
          messageId: message.id,
          internalDateMs: message.internalDateMs ?? 0,
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

  async inventoryPreviewPage(input: GmailImportWindow, maxMessages = 10) {
    const page = await this.inventoryPage(
      { ...input, maxResults: Math.min(25, Math.max(1, maxMessages)) },
      { enrich: false },
    );
    return { items: page.items, hasMore: Boolean(page.nextPageToken) };
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

  async *inventoryIncrementalGmail(
    cursor: { internalDateMs: number; messageId: string },
    now: Date,
  ): AsyncGenerator<GmailDocumentInventoryItem> {
    const after = new Date(cursor.internalDateMs);
    const before = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
    const day = (value: Date) => value.toISOString().slice(0, 10);
    const items: GmailDocumentInventoryItem[] = [];
    for await (const item of this.inventoryHistoricalGmail({ after: day(after), before: day(before) })) {
      const isNewer = item.internalDateMs > cursor.internalDateMs
        || (item.internalDateMs === cursor.internalDateMs && item.messageId > cursor.messageId);
      if (isNewer && item.internalDateMs <= now.getTime()) items.push(item);
    }
    items.sort((left, right) => left.internalDateMs - right.internalDateMs || left.messageId.localeCompare(right.messageId));
    yield* items;
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
