import { randomUUID } from "node:crypto";

import { pool as defaultPool } from "@workspace/db";

export type GmailProfileIntegrityUnresolved = {
  activityId: string;
  subject: string | null;
  occurredAt: string | null;
  reason:
    | "multiple_profile_matches"
    | "retired_profile_only"
    | "no_active_profile_link";
};

export type GmailProfileIntegrityAudit = {
  sentEmailActivities: number;
  profileEligibleSentEmails: number;
  activeProfileLinkedSentEmails: number;
  eligibleUnlinkedSentEmails: number;
  retiredProfileReferences: number;
  unresolved: GmailProfileIntegrityUnresolved[];
};

export type GmailProfileIntegrityResult = {
  canonicalReferencesRepaired: number;
  deterministicLinksRepaired: number;
  twinFallsMessage: "created" | "linked" | "existing";
  audit: GmailProfileIntegrityAudit;
};

export type GmailMessageManifest = {
  gmailMessageId: string;
  gmailThreadId: string;
  organizationId: string;
  direction: "sent" | "received";
  fromAddress: string;
  toAddresses: readonly string[];
  ccAddresses: readonly string[];
  subject: string;
  body: string;
  occurredAt: string;
};

export const TWIN_FALLS_MISSED_CALL_EMAIL = {
  gmailMessageId: "1a03f76015409bfa",
  gmailThreadId: "1a03f6d13a293ebf",
  organizationId: "b447c83c-6348-4fab-b850-0db7a5576a83",
  direction: "sent",
  fromAddress: "theadventurezone12@gmail.com",
  toAddresses: ["fair@tfcfair.com"],
  ccAddresses: [],
  subject: "Twin Falls County Fair - Sept 2-7 2026",
  occurredAt: "2026-08-26T19:04:53.000Z",
  body: `Hi Melody,

Thank you for calling me back. I tried returning your call but wasn’t able to reach you, so I wanted to follow up by email and explain my original inquiry a little better.

I had previously reached out to a couple of contacts I found associated with the Twin Falls County Fair because I wasn’t sure who specifically handles entertainment or attraction bookings.

What I’m really trying to find out is whether the Twin Falls County Fair has any interest or availability for an inflatable family entertainment area, either for this year’s fair over Labor Day weekend or potentially for future years.

The Adventure Zone brings a complete, staffed inflatable carnival area to fairs and community events. We provide the inflatables, setup, staffing, operation, and teardown.

We can work with events in a couple of different ways. Our normal arrangement is prepaid entertainment, where the event pays for the package and it is free for attendees. In some situations, we can also operate pay-for-play, where there is little or no upfront entertainment cost to the event and attendees pay to participate. With that arrangement, a percentage of our ticket sales goes back to the event host.

The reason I reached out specifically about this year is that one of our leg managers, Kristy, may already be traveling into the Twin Falls area with equipment. Since she may already be nearby, I thought it could be a good opportunity for her to stop by, meet with someone from the fair, and explain our bounce house setup in person. We also wanted to see if the fair happened to have an opening or a need we could potentially help fill on short notice.

If everything is already set for this year, I completely understand. I’d still love to find out who the best person is for me to speak with about entertainment for the 2027 fair and when you normally begin booking.

Hopefully that explains what I was trying to ask a little better! Please feel free to call or email me when you have a chance.

For photos, videos, and more information about The Adventure Zone, you can check out our website here:

https://www.the-adventure-zone.com/

Thank you,

Desiree

The Adventure Zone`,
} as const satisfies GmailMessageManifest;

export interface GmailProfileIntegrityRepository {
  ensureSchema(): Promise<void>;
  repairCanonicalReferences(): Promise<number>;
  repairDeterministicProfileLinks(): Promise<number>;
  ensureTwinFallsMissedCallEmail(): Promise<"created" | "linked" | "existing">;
  audit(): Promise<GmailProfileIntegrityAudit>;
}

type QueryResult<Row extends Record<string, unknown>> = {
  rows: Row[];
  rowCount?: number | null;
};

type QueryExecutor = {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
};

type QueryClient = QueryExecutor & {
  release(): void;
};

type QueryPool = QueryExecutor & {
  connect(): Promise<QueryClient>;
};

type AuditRow = {
  activityId: string;
  subject: string | null;
  occurredAt: Date | string | null;
  activeLinkedCount: number | string;
  retiredLinkedCount: number | string;
  candidateCount: number | string;
};

function numeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function rowCount(result: QueryResult<Record<string, unknown>>): number {
  return typeof result.rowCount === "number" ? result.rowCount : 0;
}

async function tableExists(executor: QueryExecutor, table: string): Promise<boolean> {
  const result = await executor.query<{ present: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS present",
    [`public.${table}`],
  );
  return result.rows[0]?.present === true;
}

export async function repairGmailProfileIntegrity(
  repository: GmailProfileIntegrityRepository = new PostgresGmailProfileIntegrityRepository(),
): Promise<GmailProfileIntegrityResult> {
  await repository.ensureSchema();
  const firstCanonical = await repository.repairCanonicalReferences();
  const firstDeterministic = await repository.repairDeterministicProfileLinks();
  const twinFallsMessage = await repository.ensureTwinFallsMissedCallEmail();
  const secondCanonical = await repository.repairCanonicalReferences();
  const secondDeterministic = await repository.repairDeterministicProfileLinks();
  const audit = await repository.audit();

  return {
    canonicalReferencesRepaired: firstCanonical + secondCanonical,
    deterministicLinksRepaired: firstDeterministic + secondDeterministic,
    twinFallsMessage,
    audit,
  };
}

export class PostgresGmailProfileIntegrityRepository
implements GmailProfileIntegrityRepository {
  constructor(private readonly pool: QueryPool = defaultPool as unknown as QueryPool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS gmail_activity_links (
        gmail_message_id text PRIMARY KEY,
        gmail_thread_id text,
        activity_id uuid NOT NULL UNIQUE REFERENCES activities(id) ON DELETE CASCADE,
        organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
        direction text NOT NULL CHECK (direction IN ('sent', 'received')),
        from_address text,
        to_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
        cc_addresses text[] NOT NULL DEFAULT ARRAY[]::text[],
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS gmail_activity_links_organization_idx
      ON gmail_activity_links (organization_id)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS gmail_activity_links_thread_idx
      ON gmail_activity_links (gmail_thread_id)
    `);
  }

  async repairCanonicalReferences(): Promise<number> {
    const client = await this.pool.connect();
    let total = 0;
    try {
      await client.query("BEGIN");
      for (let pass = 0; pass < 20; pass += 1) {
        let changed = 0;

        const activities = await client.query(`
          UPDATE activities AS activity
          SET organization_id = retired.consolidated_into_id,
              updated_at = now()
          FROM organizations AS retired
          WHERE activity.organization_id = retired.id
            AND retired.consolidated_into_id IS NOT NULL
        `);
        changed += rowCount(activities);

        await client.query(`
          DELETE FROM activity_associations AS duplicate_link
          USING organizations AS retired
          WHERE duplicate_link.organization_id = retired.id
            AND retired.consolidated_into_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM activity_associations AS canonical_link
              WHERE canonical_link.activity_id = duplicate_link.activity_id
                AND canonical_link.organization_id = retired.consolidated_into_id
                AND canonical_link.contact_id IS NOT DISTINCT FROM duplicate_link.contact_id
                AND canonical_link.booking_id IS NOT DISTINCT FROM duplicate_link.booking_id
            )
        `);
        const associations = await client.query(`
          UPDATE activity_associations AS association
          SET organization_id = retired.consolidated_into_id
          FROM organizations AS retired
          WHERE association.organization_id = retired.id
            AND retired.consolidated_into_id IS NOT NULL
        `);
        changed += rowCount(associations);

        const gmailLinks = await client.query(`
          UPDATE gmail_activity_links AS link
          SET organization_id = retired.consolidated_into_id,
              updated_at = now()
          FROM organizations AS retired
          WHERE link.organization_id = retired.id
            AND retired.consolidated_into_id IS NOT NULL
        `);
        changed += rowCount(gmailLinks);

        if (await tableExists(client, "google_workspace_validation_mappings")) {
          const mappings = await client.query(`
            UPDATE google_workspace_validation_mappings AS mapping
            SET organization_id = retired.consolidated_into_id,
                updated_at = now()
            FROM organizations AS retired
            WHERE mapping.organization_id = retired.id
              AND retired.consolidated_into_id IS NOT NULL
          `);
          changed += rowCount(mappings);
        }
        if (await tableExists(client, "google_workspace_validation_review_items")) {
          const reviews = await client.query(`
            UPDATE google_workspace_validation_review_items AS review
            SET resolved_organization_id = retired.consolidated_into_id,
                updated_at = now()
            FROM organizations AS retired
            WHERE review.resolved_organization_id = retired.id
              AND retired.consolidated_into_id IS NOT NULL
          `);
          changed += rowCount(reviews);
        }
        if (await tableExists(client, "google_workspace_profile_files")) {
          const files = await client.query(`
            UPDATE google_workspace_profile_files AS file
            SET organization_id = retired.consolidated_into_id,
                updated_at = now()
            FROM organizations AS retired
            WHERE file.organization_id = retired.id
              AND retired.consolidated_into_id IS NOT NULL
          `);
          changed += rowCount(files);
        }

        total += changed;
        if (changed === 0) break;
      }
      await client.query("COMMIT");
      return total;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async repairDeterministicProfileLinks(): Promise<number> {
    const client = await this.pool.connect();
    let total = 0;
    try {
      await client.query("BEGIN");
      const emailPredicate = `(
        activity.kind = 'email'
        OR lower(coalesce(activity.source_type, '')) LIKE '%gmail%'
        OR lower(coalesce(activity.source_type, '')) LIKE '%google_workspace%'
      )`;

      const bookingLinks = await client.query(`
        WITH candidate AS (
          SELECT activity.id AS activity_id, min(booking.organization_id)::uuid AS organization_id
          FROM activities AS activity
          JOIN bookings AS booking ON booking.id = activity.booking_id
          JOIN organizations AS organization ON organization.id = booking.organization_id
          WHERE ${emailPredicate}
            AND activity.deleted_at IS NULL
            AND booking.organization_id IS NOT NULL
            AND organization.consolidated_into_id IS NULL
          GROUP BY activity.id
          HAVING count(DISTINCT booking.organization_id) = 1
        )
        INSERT INTO activity_associations (
          activity_id,
          organization_id,
          contact_id,
          booking_id,
          created_at
        )
        SELECT candidate.activity_id, candidate.organization_id, NULL, NULL, now()
        FROM candidate
        WHERE NOT EXISTS (
          SELECT 1
          FROM activity_associations AS existing
          WHERE existing.activity_id = candidate.activity_id
            AND existing.organization_id = candidate.organization_id
        )
        ON CONFLICT DO NOTHING
      `);
      total += rowCount(bookingLinks);

      const contactLinks = await client.query(`
        WITH candidate AS (
          SELECT activity.id AS activity_id, min(link.organization_id)::uuid AS organization_id
          FROM activities AS activity
          JOIN organization_contacts AS link
            ON link.contact_id = activity.contact_id
           AND link.active = true
          JOIN organizations AS organization ON organization.id = link.organization_id
          WHERE ${emailPredicate}
            AND activity.deleted_at IS NULL
            AND activity.contact_id IS NOT NULL
            AND organization.consolidated_into_id IS NULL
          GROUP BY activity.id
          HAVING count(DISTINCT link.organization_id) = 1
        )
        INSERT INTO activity_associations (
          activity_id,
          organization_id,
          contact_id,
          booking_id,
          created_at
        )
        SELECT candidate.activity_id, candidate.organization_id, NULL, NULL, now()
        FROM candidate
        WHERE NOT EXISTS (
          SELECT 1
          FROM activity_associations AS existing
          WHERE existing.activity_id = candidate.activity_id
            AND existing.organization_id = candidate.organization_id
        )
        ON CONFLICT DO NOTHING
      `);
      total += rowCount(contactLinks);

      const recipientLinks = await client.query(`
        WITH candidate AS (
          SELECT activity.id AS activity_id, min(link.organization_id)::uuid AS organization_id
          FROM activities AS activity
          JOIN contacts AS contact
            ON contact.email IS NOT NULL
           AND length(btrim(contact.email)) >= 6
           AND lower(to_jsonb(activity)::text) LIKE '%' || lower(btrim(contact.email)) || '%'
          JOIN organization_contacts AS link
            ON link.contact_id = contact.id
           AND link.active = true
          JOIN organizations AS organization ON organization.id = link.organization_id
          WHERE ${emailPredicate}
            AND activity.deleted_at IS NULL
            AND organization.consolidated_into_id IS NULL
          GROUP BY activity.id
          HAVING count(DISTINCT link.organization_id) = 1
        )
        INSERT INTO activity_associations (
          activity_id,
          organization_id,
          contact_id,
          booking_id,
          created_at
        )
        SELECT candidate.activity_id, candidate.organization_id, NULL, NULL, now()
        FROM candidate
        WHERE NOT EXISTS (
          SELECT 1
          FROM activity_associations AS existing
          WHERE existing.activity_id = candidate.activity_id
            AND existing.organization_id = candidate.organization_id
        )
        ON CONFLICT DO NOTHING
      `);
      total += rowCount(recipientLinks);

      const directLinks = await client.query(`
        WITH resolved AS (
          SELECT association.activity_id,
                 min(association.organization_id)::uuid AS organization_id
          FROM activity_associations AS association
          JOIN organizations AS organization ON organization.id = association.organization_id
          WHERE organization.consolidated_into_id IS NULL
          GROUP BY association.activity_id
          HAVING count(DISTINCT association.organization_id) = 1
        )
        UPDATE activities AS activity
        SET organization_id = resolved.organization_id,
            updated_at = now()
        FROM resolved
        WHERE activity.id = resolved.activity_id
          AND (
            activity.organization_id IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM organizations AS current_organization
              WHERE current_organization.id = activity.organization_id
                AND current_organization.consolidated_into_id IS NULL
            )
          )
          AND (
            activity.kind = 'email'
            OR lower(coalesce(activity.source_type, '')) LIKE '%gmail%'
            OR lower(coalesce(activity.source_type, '')) LIKE '%google_workspace%'
          )
      `);
      total += rowCount(directLinks);

      await client.query("COMMIT");
      return total;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureTwinFallsMissedCallEmail(): Promise<"created" | "linked" | "existing"> {
    const message = TWIN_FALLS_MISSED_CALL_EMAIL;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const survivor = await client.query<{ id: string }>(
        `SELECT id::text AS id
         FROM organizations
         WHERE id = $1::uuid
           AND consolidated_into_id IS NULL
         FOR UPDATE`,
        [message.organizationId],
      );
      if (!survivor.rows[0]) {
        throw new Error("Twin Falls County Fair survivor profile is unavailable.");
      }

      const linked = await client.query<{ activityId: string }>(
        `SELECT activity_id::text AS "activityId"
         FROM gmail_activity_links
         WHERE gmail_message_id = $1
         LIMIT 1`,
        [message.gmailMessageId],
      );
      if (linked.rows[0]) {
        await client.query(
          `UPDATE gmail_activity_links
           SET organization_id = $2::uuid,
               gmail_thread_id = $3,
               direction = $4,
               from_address = $5,
               to_addresses = $6::text[],
               cc_addresses = $7::text[],
               updated_at = now()
           WHERE gmail_message_id = $1`,
          [
            message.gmailMessageId,
            message.organizationId,
            message.gmailThreadId,
            message.direction,
            message.fromAddress,
            [...message.toAddresses],
            [...message.ccAddresses],
          ],
        );
        await this.linkActivity(client, linked.rows[0].activityId, message.organizationId);
        await client.query("COMMIT");
        return "existing";
      }

      const existing = await client.query<{ id: string }>(
        `SELECT id::text AS id
         FROM activities AS activity
         WHERE activity.deleted_at IS NULL
           AND (
             lower(to_jsonb(activity)::text) LIKE '%' || lower($1) || '%'
             OR lower(to_jsonb(activity)::text) LIKE '%' || lower($2) || '%'
             OR (
               activity.subject = $3
               AND activity.occurred_at BETWEEN $4::timestamptz - interval '2 seconds'
                                            AND $4::timestamptz + interval '2 seconds'
               AND activity.body ILIKE 'Hi Melody,%Thank you for calling me back%'
             )
           )
         ORDER BY
           CASE WHEN activity.kind = 'email' THEN 0 ELSE 1 END,
           activity.created_at
         LIMIT 1
         FOR UPDATE`,
        [
          message.gmailMessageId,
          message.gmailThreadId,
          message.subject,
          message.occurredAt,
        ],
      );

      let activityId = existing.rows[0]?.id;
      let outcome: "created" | "linked" = "linked";
      if (activityId) {
        await client.query(
          `UPDATE activities
           SET organization_id = $2::uuid,
               kind = 'email',
               status = 'sent',
               subject = $3,
               body = $4,
               occurred_at = $5::timestamptz,
               timeline_sort_at = $5::timestamptz,
               source_type = COALESCE(NULLIF(source_type, ''), 'gmail'),
               updated_at = now()
           WHERE id = $1::uuid`,
          [
            activityId,
            message.organizationId,
            message.subject,
            message.body,
            message.occurredAt,
          ],
        );
      } else {
        activityId = randomUUID();
        outcome = "created";
        await client.query(
          `INSERT INTO activities (
             id,
             organization_id,
             kind,
             status,
             subject,
             body,
             occurred_at,
             timeline_sort_at,
             source_type,
             created_at,
             updated_at
           ) VALUES (
             $1::uuid,
             $2::uuid,
             'email',
             'sent',
             $3,
             $4,
             $5::timestamptz,
             $5::timestamptz,
             'gmail',
             now(),
             now()
           )`,
          [
            activityId,
            message.organizationId,
            message.subject,
            message.body,
            message.occurredAt,
          ],
        );
      }

      await this.linkActivity(client, activityId, message.organizationId);
      await client.query(
        `INSERT INTO gmail_activity_links (
           gmail_message_id,
           gmail_thread_id,
           activity_id,
           organization_id,
           direction,
           from_address,
           to_addresses,
           cc_addresses,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7::text[], $8::text[], now(), now())
         ON CONFLICT (gmail_message_id) DO UPDATE
         SET gmail_thread_id = EXCLUDED.gmail_thread_id,
             activity_id = EXCLUDED.activity_id,
             organization_id = EXCLUDED.organization_id,
             direction = EXCLUDED.direction,
             from_address = EXCLUDED.from_address,
             to_addresses = EXCLUDED.to_addresses,
             cc_addresses = EXCLUDED.cc_addresses,
             updated_at = now()`,
        [
          message.gmailMessageId,
          message.gmailThreadId,
          activityId,
          message.organizationId,
          message.direction,
          message.fromAddress,
          [...message.toAddresses],
          [...message.ccAddresses],
        ],
      );
      await client.query("COMMIT");
      return outcome;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async audit(): Promise<GmailProfileIntegrityAudit> {
    const sentRows = await this.pool.query<AuditRow>(`
      SELECT
        activity.id::text AS "activityId",
        activity.subject,
        activity.occurred_at AS "occurredAt",
        (
          CASE WHEN EXISTS (
            SELECT 1
            FROM organizations AS direct_organization
            WHERE direct_organization.id = activity.organization_id
              AND direct_organization.consolidated_into_id IS NULL
          ) THEN 1 ELSE 0 END
          + (SELECT count(DISTINCT association.organization_id)::int
             FROM activity_associations AS association
             JOIN organizations AS associated_organization
               ON associated_organization.id = association.organization_id
              AND associated_organization.consolidated_into_id IS NULL
             WHERE association.activity_id = activity.id)
          + (SELECT count(*)::int
             FROM gmail_activity_links AS gmail_link
             JOIN organizations AS linked_organization
               ON linked_organization.id = gmail_link.organization_id
              AND linked_organization.consolidated_into_id IS NULL
             WHERE gmail_link.activity_id = activity.id)
        )::int AS "activeLinkedCount",
        (
          CASE WHEN EXISTS (
            SELECT 1
            FROM organizations AS direct_retired
            WHERE direct_retired.id = activity.organization_id
              AND direct_retired.consolidated_into_id IS NOT NULL
          ) THEN 1 ELSE 0 END
          + (SELECT count(DISTINCT association.organization_id)::int
             FROM activity_associations AS association
             JOIN organizations AS retired_organization
               ON retired_organization.id = association.organization_id
              AND retired_organization.consolidated_into_id IS NOT NULL
             WHERE association.activity_id = activity.id)
          + (SELECT count(*)::int
             FROM gmail_activity_links AS gmail_link
             JOIN organizations AS retired_linked_organization
               ON retired_linked_organization.id = gmail_link.organization_id
              AND retired_linked_organization.consolidated_into_id IS NOT NULL
             WHERE gmail_link.activity_id = activity.id)
        )::int AS "retiredLinkedCount",
        (
          SELECT count(DISTINCT candidate.organization_id)::int
          FROM (
            SELECT booking.organization_id
            FROM bookings AS booking
            JOIN organizations AS booking_organization
              ON booking_organization.id = booking.organization_id
             AND booking_organization.consolidated_into_id IS NULL
            WHERE booking.id = activity.booking_id
              AND booking.organization_id IS NOT NULL
            UNION
            SELECT contact_link.organization_id
            FROM organization_contacts AS contact_link
            JOIN organizations AS contact_organization
              ON contact_organization.id = contact_link.organization_id
             AND contact_organization.consolidated_into_id IS NULL
            WHERE contact_link.contact_id = activity.contact_id
              AND contact_link.active = true
            UNION
            SELECT recipient_link.organization_id
            FROM contacts AS recipient
            JOIN organization_contacts AS recipient_link
              ON recipient_link.contact_id = recipient.id
             AND recipient_link.active = true
            JOIN organizations AS recipient_organization
              ON recipient_organization.id = recipient_link.organization_id
             AND recipient_organization.consolidated_into_id IS NULL
            WHERE recipient.email IS NOT NULL
              AND length(btrim(recipient.email)) >= 6
              AND lower(to_jsonb(activity)::text) LIKE '%' || lower(btrim(recipient.email)) || '%'
          ) AS candidate
        )::int AS "candidateCount"
      FROM activities AS activity
      WHERE activity.deleted_at IS NULL
        AND (
          activity.kind = 'email'
          OR lower(coalesce(activity.source_type, '')) LIKE '%gmail%'
          OR lower(coalesce(activity.source_type, '')) LIKE '%google_workspace%'
        )
        AND (
          lower(coalesce(activity.status, '')) IN ('sent', 'outbound')
          OR lower(to_jsonb(activity)::text) LIKE '%theadventurezone12@gmail.com%'
          OR EXISTS (
            SELECT 1
            FROM gmail_activity_links AS direction_link
            WHERE direction_link.activity_id = activity.id
              AND direction_link.direction = 'sent'
          )
        )
      ORDER BY activity.occurred_at DESC NULLS LAST, activity.id
    `);

    const unresolved: GmailProfileIntegrityUnresolved[] = [];
    let eligible = 0;
    let activeLinked = 0;
    for (const row of sentRows.rows) {
      const active = numeric(row.activeLinkedCount);
      const retired = numeric(row.retiredLinkedCount);
      const candidates = numeric(row.candidateCount);
      const isEligible = active > 0 || retired > 0 || candidates > 0;
      if (!isEligible) continue;
      eligible += 1;
      if (active > 0) {
        activeLinked += 1;
        continue;
      }
      unresolved.push({
        activityId: row.activityId,
        subject: row.subject,
        occurredAt: iso(row.occurredAt),
        reason: retired > 0
          ? "retired_profile_only"
          : candidates > 1
            ? "multiple_profile_matches"
            : "no_active_profile_link",
      });
    }

    const retiredReferences = await this.countRetiredReferences();
    return {
      sentEmailActivities: sentRows.rows.length,
      profileEligibleSentEmails: eligible,
      activeProfileLinkedSentEmails: activeLinked,
      eligibleUnlinkedSentEmails: unresolved.length,
      retiredProfileReferences: retiredReferences,
      unresolved: unresolved.slice(0, 200),
    };
  }

  private async linkActivity(
    executor: QueryExecutor,
    activityId: string,
    organizationId: string,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO activity_associations (
         activity_id,
         organization_id,
         contact_id,
         booking_id,
         created_at
       )
       SELECT $1::uuid, $2::uuid, NULL, NULL, now()
       WHERE NOT EXISTS (
         SELECT 1
         FROM activity_associations
         WHERE activity_id = $1::uuid
           AND organization_id = $2::uuid
       )
       ON CONFLICT DO NOTHING`,
      [activityId, organizationId],
    );
    await executor.query(
      `UPDATE activities
       SET organization_id = $2::uuid,
           updated_at = now()
       WHERE id = $1::uuid`,
      [activityId, organizationId],
    );
  }

  private async countRetiredReferences(): Promise<number> {
    let total = 0;
    const direct = await this.pool.query<{ count: number | string }>(`
      SELECT count(*)::int AS count
      FROM activities AS activity
      JOIN organizations AS retired ON retired.id = activity.organization_id
      WHERE activity.deleted_at IS NULL
        AND retired.consolidated_into_id IS NOT NULL
        AND (
          activity.kind = 'email'
          OR lower(coalesce(activity.source_type, '')) LIKE '%gmail%'
          OR lower(coalesce(activity.source_type, '')) LIKE '%google_workspace%'
        )
    `);
    total += numeric(direct.rows[0]?.count);

    const associations = await this.pool.query<{ count: number | string }>(`
      SELECT count(*)::int AS count
      FROM activity_associations AS association
      JOIN activities AS activity ON activity.id = association.activity_id
      JOIN organizations AS retired ON retired.id = association.organization_id
      WHERE activity.deleted_at IS NULL
        AND retired.consolidated_into_id IS NOT NULL
        AND (
          activity.kind = 'email'
          OR lower(coalesce(activity.source_type, '')) LIKE '%gmail%'
          OR lower(coalesce(activity.source_type, '')) LIKE '%google_workspace%'
        )
    `);
    total += numeric(associations.rows[0]?.count);

    const links = await this.pool.query<{ count: number | string }>(`
      SELECT count(*)::int AS count
      FROM gmail_activity_links AS link
      JOIN organizations AS retired ON retired.id = link.organization_id
      WHERE retired.consolidated_into_id IS NOT NULL
    `);
    total += numeric(links.rows[0]?.count);

    if (await tableExists(this.pool, "google_workspace_validation_mappings")) {
      const mappings = await this.pool.query<{ count: number | string }>(`
        SELECT count(*)::int AS count
        FROM google_workspace_validation_mappings AS mapping
        JOIN organizations AS retired ON retired.id = mapping.organization_id
        WHERE retired.consolidated_into_id IS NOT NULL
      `);
      total += numeric(mappings.rows[0]?.count);
    }
    if (await tableExists(this.pool, "google_workspace_validation_review_items")) {
      const reviews = await this.pool.query<{ count: number | string }>(`
        SELECT count(*)::int AS count
        FROM google_workspace_validation_review_items AS review
        JOIN organizations AS retired ON retired.id = review.resolved_organization_id
        WHERE retired.consolidated_into_id IS NOT NULL
      `);
      total += numeric(reviews.rows[0]?.count);
    }
    if (await tableExists(this.pool, "google_workspace_profile_files")) {
      const files = await this.pool.query<{ count: number | string }>(`
        SELECT count(*)::int AS count
        FROM google_workspace_profile_files AS file
        JOIN organizations AS retired ON retired.id = file.organization_id
        WHERE retired.consolidated_into_id IS NOT NULL
      `);
      total += numeric(files.rows[0]?.count);
    }
    return total;
  }
}
