import { fingerprint } from "./action-store";
import type { Queryable } from "./contracts";
import type { WorkspaceDraft } from "./draft-store";
import type { GoogleWorkspaceReadClient } from "../google-workspace/google-api-types";
// Hash current source identities, not model assertions. Draft messages are excluded
// because saving a draft changes them without changing customer evidence.
export async function captureSendSources(
  db: Queryable,
  client: Pick<
    GoogleWorkspaceReadClient,
    "listMessagePage" | "getThreadDetail" | "getMessageMetadata"
  >,
  draft: WorkspaceDraft,
): Promise<string> {
  if (
    !client.listMessagePage ||
    !client.getThreadDetail ||
    !client.getMessageMetadata
  )
    throw new Error("ASSISTANT_SOURCE_READBACK_UNAVAILABLE");
  const recipients = [...draft.content.to, ...draft.content.cc];
  if (
    recipients.some(
      (e) => !/^[-A-Za-z0-9.!#$%&'*+/=?^_`{|}~]+@[A-Za-z0-9.-]+$/.test(e),
    )
  )
    throw new Error("ASSISTANT_RECIPIENT_INVALID");
  const query = `-in:drafts {${recipients.flatMap((e) => [`from:${e}`, `to:${e}`, `cc:${e}`]).join(" ")}}`;
  const ids = new Set<string>();
  let cursor: string | undefined;
  const cursors = new Set<string>();
  for (let n = 0; n < 40; n++) {
    const page = await client.listMessagePage({
      query,
      maxResults: 100,
      ...(cursor ? { pageToken: cursor } : {}),
    });
    for (const m of page.messages) ids.add(m.id);
    cursor = page.nextPageToken ?? undefined;
    if (!cursor) break;
    if (cursors.has(cursor))
      throw new Error("ASSISTANT_SOURCE_HISTORY_INCOMPLETE");
    cursors.add(cursor);
  }
  if (cursor) throw new Error("ASSISTANT_SOURCE_HISTORY_INCOMPLETE");
  const thread = draft.content.threadId
    ? await client.getThreadDetail(draft.content.threadId)
    : null;
  const profile = await db.query(
    "SELECT to_jsonb(o) AS value FROM organizations o WHERE id=$1",
    [draft.content.organizationId],
  );
  const booking = draft.content.bookingId
    ? await db.query(
        "SELECT to_jsonb(b) AS value FROM bookings b WHERE b.id=$1 AND b.organization_id=$2 AND EXISTS (SELECT 1 FROM booking_opportunities o WHERE o.booking_id=b.id AND o.organization_id=b.organization_id AND o.event_year=$3)",
        [
          draft.content.bookingId,
          draft.content.organizationId,
          draft.content.eventYear,
        ],
      )
    : { rows: [] };
  if (draft.content.bookingId && booking.rows.length !== 1)
    throw new Error("ASSISTANT_BOOKING_YEAR_MISMATCH");
  const agreements = await db.query(
    "SELECT to_jsonb(c) AS value FROM contract_agreements c WHERE organization_id=$1 ORDER BY id",
    [draft.content.organizationId],
  );
  const invoices = await db.query(
    "SELECT to_jsonb(i) AS value FROM invoices i WHERE organization_id=$1 ORDER BY id",
    [draft.content.organizationId],
  );
  const payments = await db.query(
    "SELECT to_jsonb(p) AS value FROM invoice_payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.organization_id=$1 ORDER BY p.id",
    [draft.content.organizationId],
  );
  const documents = await db.query(
    "SELECT to_jsonb(d) AS value FROM business_documents d WHERE d.id IN (SELECT document_id FROM business_document_links WHERE organization_id=$1 OR booking_id=$3) OR d.id=ANY($2::uuid[]) ORDER BY d.id",
    [
      draft.content.organizationId,
      draft.content.attachmentIds,
      draft.content.bookingId ?? null,
    ],
  );
  const rules = await db.query(
    "SELECT to_jsonb(r) AS value FROM assistant_workspace_rules r WHERE status='approved' AND (organization_id IS NULL OR organization_id=$1) AND (event_year IS NULL OR event_year=$2) AND effective_from<=current_date AND (effective_to IS NULL OR effective_to>=current_date) ORDER BY id",
    [draft.content.organizationId, draft.content.eventYear],
  );
  const template = await db.query(
    "SELECT to_jsonb(t) AS value FROM communication_templates t WHERE id=$1",
    [draft.content.templateId],
  );
  if (
    !template.rows[0] ||
    template.rows[0].value.state !== "active" ||
    !template.rows[0].value.reviewed_at ||
    template.rows[0].value.template_version !== draft.content.templateVersion
  )
    throw new Error("ASSISTANT_CURRENT_TEMPLATE_REQUIRED");
  // Only delivered message IDs are stable across Gmail draft edits.
  const deliveredMessages = [];
  if (thread) {
    if (thread.messages.length > 500)
      throw new Error("ASSISTANT_SOURCE_HISTORY_INCOMPLETE");
    for (const message of thread.messages) {
      const metadata = await client.getMessageMetadata(message.id);
      if (!metadata.labelIds.includes("DRAFT")) deliveredMessages.push(message);
    }
  }
  const deliveredThread = thread
    ? { ...thread, messages: deliveredMessages }
    : null;
  return fingerprint({
    ids: [...ids].sort(),
    thread: deliveredThread,
    profile: profile.rows,
    documents: documents.rows,
    booking: booking.rows,
    agreements: agreements.rows,
    invoices: invoices.rows,
    payments: payments.rows,
    rules: rules.rows,
    template: template.rows,
  });
}
