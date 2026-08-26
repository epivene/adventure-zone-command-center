import { sql, type SQL } from "drizzle-orm";

import type { LeadRelationshipEvidence } from "./lead-relationship-classifier";

type GoogleMessageMetadata = {
  id: string;
  internalDateMs: number | null;
  snippet: string;
  headers: { from: string; to: string; cc: string; subject: string; date: string };
};

type GoogleWorkspaceReadClient = {
  accountIdentity(): Promise<{ email: string }>;
  getMessageMetadata?(id: string): Promise<GoogleMessageMetadata>;
};

type QueryDatabase = { execute(query: SQL): Promise<unknown> };
type Row = Record<string, unknown>;

export interface LeadRelationshipEvidenceSource {
  list(input: { organizationId: string; recipientEmail: string }): Promise<LeadRelationshipEvidence[]>;
}

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Row[] }).rows;
  }
  return [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function emails(value: unknown) {
  const source = typeof value === "string" ? value : "";
  return [...new Set(
    (source.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi) ?? [])
      .map(normalizedEmail),
  )];
}

function excerpt(...values: unknown[]) {
  const value = values.map(text).find(Boolean) ?? "";
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function validDate(...values: unknown[]): Date | null {
  for (const value of values) {
    if (value instanceof Date && Number.isFinite(value.valueOf())) return value;
    if (typeof value === "number" || typeof value === "string") {
      const candidate = new Date(value);
      if (Number.isFinite(candidate.valueOf())) return candidate;
    }
  }
  return null;
}

function normalizedKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function structuredValues(raw: unknown, keys: Set<string>): unknown[] {
  const found: unknown[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (keys.has(normalizedKey(key))) found.push(child);
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(raw);
  return found;
}

function firstStructuredText(raw: unknown, keys: string[]) {
  return structuredValues(raw, new Set(keys)).map(text).find(Boolean) ?? null;
}

const inboundValues = new Set(["inbound", "incoming", "received", "replied", "email received", "e-mail received"]);
const outboundValues = new Set(["outbound", "outgoing", "sent", "email sent", "e-mail sent"]);

function actDirection(raw: unknown, recipientEmail: string) {
  const normalizedRecipient = normalizedEmail(recipientEmail);
  const directions = structuredValues(raw, new Set(["direction", "emaildirection", "messagedirection"]))
    .map((value) => text(value)?.toLowerCase())
    .filter((value): value is string => Boolean(value));
  const replied = structuredValues(raw, new Set(["replied"]))
    .some((value) => value === true || ["true", "yes", "replied"].includes(text(value)?.toLowerCase() ?? ""));
  const inbound = replied || directions.some((value) => inboundValues.has(value));
  const outbound = directions.some((value) => outboundValues.has(value));
  const from = structuredValues(raw, new Set(["from", "fromemail", "sender", "senderemail"]))
    .flatMap(emails);
  const to = structuredValues(raw, new Set(["to", "toemail", "recipient", "recipientemail", "cc"]))
    .flatMap(emails);

  if (inbound === outbound || (inbound && !from.includes(normalizedRecipient)) || (outbound && !to.includes(normalizedRecipient))) {
    return { direction: "unknown" as const, responseProven: false, conflicting: inbound || outbound };
  }
  if (inbound) return { direction: "inbound" as const, responseProven: true, conflicting: false };
  return { direction: "outbound" as const, responseProven: false, conflicting: false };
}

function actEvidence(row: Row, input: { organizationId: string; recipientEmail: string }): LeadRelationshipEvidence {
  const raw = row.raw_snapshot && typeof row.raw_snapshot === "object" ? row.raw_snapshot : {};
  const direction = actDirection(raw, input.recipientEmail);
  const gmailMessageId = firstStructuredText(raw, ["gmailmessageid"]);
  const sourceId = gmailMessageId ?? String(row.source_id);
  const occurredAt = validDate(
    firstStructuredText(raw, ["starttime", "scheduledate", "displaydate", "created", "createdate", "date"]),
    row.source_created_at,
    row.source_edited_at,
    row.fetched_at,
  ) ?? new Date(Number.NaN);
  return {
    evidenceId: `act:${String(row.version_id)}`,
    sourceType: gmailMessageId ? "gmail" : "act",
    sourceId,
    occurredAt,
    ...direction,
    organizationId: input.organizationId,
    contactId: null,
    recipientEmail: input.recipientEmail,
    excerpt: excerpt(
      firstStructuredText(raw, ["subject", "regarding"]),
      firstStructuredText(raw, ["details", "body", "notetext"]),
    ),
  };
}

function gmailDirection(metadata: GoogleMessageMetadata, mailbox: string, recipientEmail: string) {
  const from = emails(metadata.headers.from);
  const destinations = [...emails(metadata.headers.to), ...emails(metadata.headers.cc)];
  const recipient = normalizedEmail(recipientEmail);
  const account = normalizedEmail(mailbox);
  const inbound = from.includes(recipient) && destinations.includes(account);
  const outbound = from.includes(account) && destinations.includes(recipient);
  if (inbound === outbound) {
    return { direction: "unknown" as const, responseProven: false, conflicting: true };
  }
  return inbound
    ? { direction: "inbound" as const, responseProven: true, conflicting: false }
    : { direction: "outbound" as const, responseProven: false, conflicting: false };
}

function equivalent(left: LeadRelationshipEvidence, right: LeadRelationshipEvidence) {
  return left.occurredAt.valueOf() === right.occurredAt.valueOf()
    && left.direction === right.direction
    && left.responseProven === right.responseProven
    && left.organizationId === right.organizationId
    && left.contactId === right.contactId
    && normalizedEmail(left.recipientEmail ?? "") === normalizedEmail(right.recipientEmail ?? "")
    && left.conflicting === right.conflicting;
}

function collapse(evidence: LeadRelationshipEvidence[]) {
  const groups = new Map<string, LeadRelationshipEvidence[]>();
  for (const item of evidence) {
    const key = `${item.sourceType}:${item.sourceId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].map((items) => {
    const ordered = [...items].sort((left, right) => {
      const leftPriority = left.evidenceId.startsWith("gmail:") ? 0 : 1;
      const rightPriority = right.evidenceId.startsWith("gmail:") ? 0 : 1;
      return leftPriority - rightPriority || left.evidenceId.localeCompare(right.evidenceId);
    });
    if (ordered.every((item) => equivalent(ordered[0], item))) return ordered[0];
    return { ...ordered[0], direction: "unknown" as const, responseProven: false, conflicting: true };
  }).sort((left, right) => left.occurredAt.valueOf() - right.occurredAt.valueOf() || left.evidenceId.localeCompare(right.evidenceId));
}

export class LeadRelationshipEvidenceRepository implements LeadRelationshipEvidenceSource {
  constructor(
    private readonly database: QueryDatabase,
    private readonly google?: GoogleWorkspaceReadClient,
  ) {}

  async list(input: { organizationId: string; recipientEmail: string }): Promise<LeadRelationshipEvidence[]> {
    const actRows = rowsOf(await this.database.execute(sql`
      with linked_sources as (
        select distinct s.id
          from act_source_records s
          inner join act_source_assignments a on a.source_record_id = s.id
          left join activities target_activity
            on a.target_entity_type = 'activity' and target_activity.id = a.target_entity_id
         where s.stream_type in ('activity', 'note', 'history')
           and a.superseded_at is null
           and ((a.target_entity_type = 'organization' and a.target_entity_id = ${input.organizationId}::uuid)
             or (a.target_entity_type = 'activity' and target_activity.organization_id = ${input.organizationId}::uuid))
        union
        select distinct s.id
          from act_source_records s
          inner join act_external_links e on e.source_record_id = s.id
          left join activities target_activity
            on e.entity_type = 'activity' and target_activity.id = e.entity_id
         where s.stream_type in ('activity', 'note', 'history')
           and ((e.entity_type = 'organization' and e.entity_id = ${input.organizationId}::uuid)
             or (e.entity_type = 'activity' and target_activity.organization_id = ${input.organizationId}::uuid))
        union
        select distinct source_record_id
          from activities
         where organization_id = ${input.organizationId}::uuid
           and source_record_id is not null
           and deleted_at is null
      )
      select s.id as source_id, v.id as version_id, v.raw_snapshot,
             v.source_created_at, v.source_edited_at, v.fetched_at
        from linked_sources linked
        inner join act_source_records s on s.id = linked.id
        inner join act_source_record_versions v on v.id = s.latest_version_id
       order by v.fetched_at, v.id
    `));
    const evidence = actRows.map((row) => actEvidence(row, input));

    const crmRows = rowsOf(await this.database.execute(sql`
      select id, contact_id, act_record_id, occurred_at, timeline_sort_at, subject, body
        from activities
       where organization_id = ${input.organizationId}::uuid
         and source_record_id is null
         and act_record_id is not null
         and deleted_at is null
       order by timeline_sort_at, id
    `));
    evidence.push(...crmRows.map((row): LeadRelationshipEvidence => ({
      evidenceId: `crm:${String(row.id)}`,
      sourceType: "crm",
      sourceId: String(row.act_record_id),
      occurredAt: validDate(row.occurred_at, row.timeline_sort_at) ?? new Date(Number.NaN),
      direction: "unknown",
      responseProven: false,
      organizationId: input.organizationId,
      contactId: text(row.contact_id),
      recipientEmail: input.recipientEmail,
      excerpt: excerpt(row.subject, row.body),
      conflicting: false,
    })));

    const mappingRows = rowsOf(await this.database.execute(sql`
      with current_connection as (
        select id from google_workspace_connections
         where status in ('connected', 'reauthorization_required')
         order by updated_at desc limit 1
      )
      select m.message_id, m.contact_id, m.updated_at
        from google_workspace_validation_mappings m
        inner join current_connection c on c.id = m.connection_id
        inner join google_workspace_validation_state s
          on s.connection_id = m.connection_id and s.validation_status = 'approved'
       where m.organization_id = ${input.organizationId}::uuid
       order by m.updated_at, m.message_id
    `));
    if (mappingRows.length) {
      let mailbox: string | null = null;
      if (this.google?.getMessageMetadata) {
        try {
          mailbox = (await this.google.accountIdentity()).email;
        } catch {
          mailbox = null;
        }
      }
      for (const row of mappingRows) {
        const messageId = String(row.message_id);
        let metadata: GoogleMessageMetadata | null = null;
        if (mailbox && this.google?.getMessageMetadata) {
          try {
            metadata = await this.google.getMessageMetadata(messageId);
          } catch {
            metadata = null;
          }
        }
        const occurredAt = validDate(metadata?.internalDateMs, metadata?.headers.date, row.updated_at) ?? new Date(Number.NaN);
        evidence.push({
          evidenceId: `gmail:${messageId}`,
          sourceType: "gmail",
          sourceId: messageId,
          occurredAt,
          ...(metadata && mailbox
            ? gmailDirection(metadata, mailbox, input.recipientEmail)
            : { direction: "unknown" as const, responseProven: false, conflicting: true }),
          organizationId: input.organizationId,
          contactId: text(row.contact_id),
          recipientEmail: input.recipientEmail,
          excerpt: metadata ? excerpt(metadata.headers.subject, metadata.snippet) : "",
        });
      }
    }
    return collapse(evidence);
  }
}
