import type { GoogleWorkspaceReadClient } from "../google-workspace/google-api-types";
import type {
  ActivityBackupSummary,
  EmailBackupSummary,
  FollowUpBackupSnapshot,
  FollowUpBackupSummary,
  LabeledValue,
  ProfileBackupSnapshot,
} from "./google-drive-backup-types";

type QueryResult = { rows: Array<Record<string, unknown>> };
export type GoogleDriveBackupSnapshotSqlPool = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

export interface GoogleProfileEmailSummaryProvider {
  listSummaries(
    organizationId: string,
    limit: number,
  ): Promise<EmailBackupSummary[]>;
}

type GoogleReadClientFactory = {
  createReadClient(): Promise<GoogleWorkspaceReadClient | null>;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function iso(value: unknown): string | null {
  const date = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function latestVersion(values: unknown[], fallback: Date): string {
  const timestamps = values
    .map(iso)
    .filter((value): value is string => value !== null)
    .sort();
  return timestamps.at(-1) ?? fallback.toISOString();
}

function profileUrl(appOrigin: string, organizationId: string): string {
  return `${appOrigin.replace(/\/$/, "")}/organizations/${encodeURIComponent(
    organizationId,
  )}`;
}

function labeled(
  output: LabeledValue[],
  label: string,
  value: unknown,
): void {
  const normalized = text(value);
  if (normalized) output.push({ label, value: normalized });
}

export class GoogleWorkspaceProfileEmailProvider
implements GoogleProfileEmailSummaryProvider {
  constructor(private readonly options: {
    pool: GoogleDriveBackupSnapshotSqlPool;
    connections: GoogleReadClientFactory;
    appOrigin: string;
  }) {}

  async listSummaries(
    organizationId: string,
    limit: number,
  ): Promise<EmailBackupSummary[]> {
    const boundedLimit = Math.min(20, Math.max(1, Math.trunc(limit)));
    const result = await this.options.pool.query(
      `SELECT m.message_id
         FROM google_workspace_validation_mappings m
         JOIN google_workspace_validation_state s
           ON s.connection_id = m.connection_id
          AND s.validation_status = 'approved'
        WHERE m.organization_id = $1
        ORDER BY m.updated_at DESC, m.message_id DESC
        LIMIT $2`,
      [organizationId, boundedLimit],
    );
    const client = await this.options.connections.createReadClient();
    if (!client?.getMessageMetadata || result.rows.length === 0) return [];

    const appUrl = profileUrl(this.options.appOrigin, organizationId);
    const summaries: EmailBackupSummary[] = [];
    for (const row of result.rows) {
      const messageId = text(row.message_id);
      if (!messageId) continue;
      const metadata = await client.getMessageMetadata(messageId);
      const occurredAt =
        metadata.internalDateMs === null
          ? iso(metadata.headers.date)
          : iso(metadata.internalDateMs);
      if (!occurredAt) continue;
      summaries.push({
        messageId,
        occurredAt,
        sender: metadata.headers.from.trim() || "Unknown sender",
        subject: metadata.headers.subject.trim() || "(No subject)",
        summary: metadata.snippet.replace(/\s+/g, " ").trim().slice(0, 240),
        appUrl,
      });
    }
    return summaries.sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt)
    );
  }
}

export class GoogleDriveBackupSnapshotRepository {
  private readonly pool: GoogleDriveBackupSnapshotSqlPool;
  private readonly appOrigin: string;
  private readonly emailProvider: GoogleProfileEmailSummaryProvider | undefined;

  constructor(options: {
    pool: GoogleDriveBackupSnapshotSqlPool;
    appOrigin: string;
    emailProvider?: GoogleProfileEmailSummaryProvider;
  }) {
    this.pool = options.pool;
    this.appOrigin = options.appOrigin.replace(/\/$/, "");
    this.emailProvider = options.emailProvider;
  }

  private async organization(
    organizationId: string,
  ): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query(
      `SELECT o.id, o.name, o.phone, o.website, o.address_1, o.address_2,
              o.city, o.region, o.postal_code, o.updated_at
         FROM organizations o
        WHERE o.id = $1
          AND o.consolidated_into_id IS NULL
        LIMIT 1`,
      [organizationId],
    );
    return result.rows[0] ?? null;
  }

  async getProfileSnapshot(
    organizationId: string,
    now: Date,
  ): Promise<ProfileBackupSnapshot | null> {
    const organization = await this.organization(organizationId);
    if (!organization) return null;

    const [contacts, bookings, activities, emailSummaries] = await Promise.all([
      this.pool.query(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
                c.job_title, c.updated_at
           FROM contacts c
          WHERE c.organization_id = $1
          ORDER BY c.updated_at DESC, c.id
          LIMIT 50`,
        [organizationId],
      ),
      this.pool.query(
        `SELECT b.id, b.name, b.status, b.starts_at, b.city, b.region,
                b.updated_at
           FROM bookings b
          WHERE b.organization_id = $1
          ORDER BY b.starts_at DESC NULLS LAST, b.updated_at DESC, b.id
          LIMIT 50`,
        [organizationId],
      ),
      this.pool.query(
        `SELECT a.id, a.kind, a.subject, a.status, a.timeline_sort_at,
                a.updated_at
           FROM activities a
          WHERE a.organization_id = $1
            AND a.deleted_at IS NULL
          ORDER BY a.timeline_sort_at DESC, a.id DESC
          LIMIT 20`,
        [organizationId],
      ),
      this.emailProvider?.listSummaries(organizationId, 20) ?? Promise.resolve([]),
    ]);

    const contactDetails: LabeledValue[] = [];
    labeled(contactDetails, "Phone", organization.phone);
    labeled(contactDetails, "Website", organization.website);
    const organizationLocation = [
      text(organization.address_1),
      text(organization.address_2),
      [text(organization.city), text(organization.region)]
        .filter(Boolean)
        .join(", "),
      text(organization.postal_code),
    ].filter(Boolean).join(", ");
    labeled(contactDetails, "Address", organizationLocation);

    for (const row of contacts.rows) {
      const name = [text(row.first_name), text(row.last_name)]
        .filter(Boolean)
        .join(" ");
      const title = text(row.job_title);
      labeled(
        contactDetails,
        "Contact",
        title ? `${name} — ${title}` : name,
      );
      labeled(contactDetails, "Email", row.email);
      labeled(contactDetails, "Contact phone", row.phone);
    }

    const recentActivity: ActivityBackupSummary[] = activities.rows.flatMap(
      (row) => {
        const occurredAt = iso(row.timeline_sort_at);
        const id = text(row.id);
        if (!occurredAt || !id) return [];
        return [{
          id,
          kind: text(row.kind) || "activity",
          title: text(row.subject) || text(row.status) || text(row.kind) ||
            "Activity",
          occurredAt,
        }];
      },
    );

    const appUrl = profileUrl(this.appOrigin, organizationId);
    return {
      profileId: organizationId,
      displayName: text(organization.name) || "Unnamed profile",
      contactDetails,
      bookings: bookings.rows.flatMap((row) => {
        const id = text(row.id);
        if (!id) return [];
        return [{
          id,
          name: text(row.name) || "Unnamed event",
          status: text(row.status) || "unknown",
          startsAt: iso(row.starts_at),
          location: [text(row.city), text(row.region)]
            .filter(Boolean)
            .join(", "),
        }];
      }),
      recentActivity,
      emailSummaries,
      appUrl,
      generatedAt: now,
      sourceVersion: latestVersion([
        organization.updated_at,
        ...contacts.rows.map((row) => row.updated_at),
        ...bookings.rows.map((row) => row.updated_at),
        ...activities.rows.map((row) => row.updated_at),
        ...emailSummaries.map((item) => item.occurredAt),
      ], now),
    };
  }

  async getFollowUpSnapshot(
    organizationId: string,
    now: Date,
  ): Promise<FollowUpBackupSnapshot | null> {
    const organization = await this.organization(organizationId);
    if (!organization) return null;

    const result = await this.pool.query(
      `SELECT f.id, f.kind, f.due_at, f.completed_at, f.outcome,
              f.updated_at, b.name AS booking_name
         FROM follow_ups f
         LEFT JOIN bookings b ON b.id = f.booking_id
        WHERE COALESCE(
          f.organization_id,
          b.organization_id,
          (SELECT c.organization_id FROM contacts c WHERE c.id = f.contact_id)
        ) = $1
        ORDER BY f.completed_at DESC NULLS FIRST, f.due_at, f.id
        LIMIT 500`,
      [organizationId],
    );

    const mapped: FollowUpBackupSummary[] = result.rows.flatMap((row) => {
      const id = text(row.id);
      const dueAt = iso(row.due_at);
      if (!id || !dueAt) return [];
      return [{
        id,
        kind: text(row.kind) || "follow-up",
        dueAt,
        completedAt: iso(row.completed_at),
        outcome: text(row.outcome) || null,
        bookingName: text(row.booking_name) || null,
      }];
    });
    const nowIso = now.toISOString();
    const open = mapped
      .filter((item) => item.completedAt === null && item.dueAt <= nowIso)
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
    const scheduled = mapped
      .filter((item) => item.completedAt === null && item.dueAt > nowIso)
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
    const completedRecent = mapped
      .filter((item) => item.completedAt !== null)
      .sort((left, right) =>
        right.completedAt!.localeCompare(left.completedAt!)
      )
      .slice(0, 20);

    return {
      profileId: organizationId,
      displayName: text(organization.name) || "Unnamed profile",
      open,
      scheduled,
      completedRecent,
      appUrl: profileUrl(this.appOrigin, organizationId),
      generatedAt: now,
      sourceVersion: latestVersion([
        organization.updated_at,
        ...result.rows.map((row) => row.updated_at),
      ], now),
    };
  }
}
