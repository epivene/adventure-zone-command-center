import { pool as defaultPool } from "@workspace/db";

export type ProfileIntegritySeverity = "error" | "warning" | "info";

export type ProfileIntegrityIssue = {
  code: string;
  severity: ProfileIntegritySeverity;
  profileId: string | null;
  profileName: string | null;
  appearanceId: string | null;
  message: string;
  autoFixable: boolean;
  evidence: Record<string, unknown>;
};

export type ProfileIntegrityProfile = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  actRecordId: string | null;
  updatedAt: string | null;
  contactCount: number;
  appearanceCount: number;
  actAppearanceCount: number;
  timelineCount: number;
  firstTimelineAt: string | null;
  latestTimelineAt: string | null;
  openFollowUpCount: number;
  gmailThreadCount: number;
  calendarLinkCount: number;
  pendingCalendarReviewCount: number;
};

export type ProfileIntegrityReport = {
  ok: true;
  generatedAt: string;
  mode: "read_only";
  summary: {
    profileCount: number;
    profileWithActSourceCount: number;
    profileWithoutActSourceCount: number;
    profileWithGmailCount: number;
    profileWithCalendarCount: number;
    issueCount: number;
    errorCount: number;
    warningCount: number;
    autoFixableCount: number;
    reviewRequiredCount: number;
    duplicateAppearanceGroupCount: number;
    duplicateContactGroupCount: number;
    pendingGmailReviewCount: number;
    pendingCalendarReviewCount: number;
  };
  connections: {
    googleWorkspace: Array<Record<string, unknown>>;
    gmailValidation: Array<Record<string, unknown>>;
  };
  profiles: ProfileIntegrityProfile[];
  issues: ProfileIntegrityIssue[];
};

type QueryResult = { rows: Array<Record<string, unknown>> };

type SqlPool = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function number(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function recordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function iso(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : raw;
}

function issue(input: Omit<ProfileIntegrityIssue, "profileId" | "profileName" | "appearanceId" | "evidence"> & {
  profileId?: string | null;
  profileName?: string | null;
  appearanceId?: string | null;
  evidence?: Record<string, unknown>;
}): ProfileIntegrityIssue {
  return {
    ...input,
    profileId: input.profileId ?? null,
    profileName: input.profileName ?? null,
    appearanceId: input.appearanceId ?? null,
    evidence: input.evidence ?? {},
  };
}

export class ProfileIntegrityAuditService {
  constructor(private readonly pool: SqlPool = defaultPool as unknown as SqlPool) {}

  async run(now = new Date()): Promise<ProfileIntegrityReport> {
    if (!Number.isFinite(now.getTime())) throw new Error("PROFILE_INTEGRITY_AUDIT_INVALID_DATE");

    const [
      profileResult,
      duplicateAppearanceResult,
      duplicateContactResult,
      gmailConnectionResult,
      gmailValidationResult,
      pendingGmailReviewResult,
      orphanGmailResult,
      calendarStatusResult,
      calendarOrphanResult,
      pendingCalendarReviewResult,
      duplicateActActivityResult,
      timelineFallbackResult,
      unownedActivityResult,
      actLinkConflictResult,
    ] = await Promise.all([
      this.pool.query(PROFILE_SUMMARY_SQL),
      this.pool.query(DUPLICATE_APPEARANCE_SQL),
      this.pool.query(DUPLICATE_CONTACT_SQL),
      this.pool.query(GOOGLE_CONNECTION_SQL),
      this.pool.query(GMAIL_VALIDATION_STATE_SQL),
      this.pool.query(PENDING_GMAIL_REVIEW_SQL),
      this.pool.query(ORPHAN_GMAIL_MAPPING_SQL),
      this.pool.query(CALENDAR_STATUS_MISMATCH_SQL),
      this.pool.query(ORPHAN_CALENDAR_LINK_SQL),
      this.pool.query(PENDING_CALENDAR_REVIEW_SQL),
      this.pool.query(DUPLICATE_ACT_ACTIVITY_SQL),
      this.pool.query(TIMELINE_FALLBACK_SQL),
      this.pool.query(UNOWNED_ACTIVITY_SQL),
      this.pool.query(ACT_LINK_CONFLICT_SQL),
    ]);

    const profiles: ProfileIntegrityProfile[] = profileResult.rows.flatMap((row) => {
      const id = text(row.id);
      const name = text(row.name);
      if (!id || !name) return [];
      return [{
        id,
        name,
        city: text(row.city),
        region: text(row.region),
        actRecordId: text(row.act_record_id),
        updatedAt: iso(row.updated_at),
        contactCount: number(row.contact_count),
        appearanceCount: number(row.appearance_count),
        actAppearanceCount: number(row.act_appearance_count),
        timelineCount: number(row.timeline_count),
        firstTimelineAt: iso(row.first_timeline_at),
        latestTimelineAt: iso(row.latest_timeline_at),
        openFollowUpCount: number(row.open_follow_up_count),
        gmailThreadCount: number(row.gmail_thread_count),
        calendarLinkCount: number(row.calendar_link_count),
        pendingCalendarReviewCount: number(row.pending_calendar_review_count),
      }];
    });

    const issues: ProfileIntegrityIssue[] = [];

    for (const row of duplicateAppearanceResult.rows) {
      const ids = stringList(row.appearance_ids);
      issues.push(issue({
        code: "duplicate_appearance_exact",
        severity: "error",
        profileId: text(row.organization_id),
        profileName: text(row.profile_name),
        appearanceId: ids[0] ?? null,
        message: `${number(row.duplicate_count)} exact yearly appearance records represent the same event dates.`,
        autoFixable: true,
        evidence: {
          appearanceIds: ids,
          eventName: text(row.event_name),
          city: text(row.city),
          region: text(row.region),
          startsOn: text(row.starts_on),
          endsOn: text(row.ends_on),
          statuses: stringList(row.statuses),
          actRecordIds: stringList(row.act_record_ids),
        },
      }));
    }

    for (const row of duplicateContactResult.rows) {
      issues.push(issue({
        code: "duplicate_profile_contact",
        severity: "warning",
        profileId: text(row.organization_id),
        profileName: text(row.profile_name),
        message: `${number(row.duplicate_count)} active contact records have the same identity on this profile.`,
        autoFixable: false,
        evidence: {
          contactIds: stringList(row.contact_ids),
          contactName: text(row.contact_name),
          email: text(row.email),
          normalizedPhone: text(row.normalized_phone),
          actRecordIds: stringList(row.act_record_ids),
        },
      }));
    }

    for (const row of orphanGmailResult.rows) {
      issues.push(issue({
        code: "gmail_mapping_missing_profile",
        severity: "error",
        profileId: text(row.organization_id),
        message: "A Gmail validation mapping points to a profile that no longer exists or was retired.",
        autoFixable: Boolean(text(row.consolidated_into_id)),
        evidence: {
          messageId: text(row.message_id),
          threadId: text(row.thread_id),
          consolidatedIntoId: text(row.consolidated_into_id),
        },
      }));
    }

    for (const row of calendarStatusResult.rows) {
      issues.push(issue({
        code: "calendar_status_mismatch",
        severity: "error",
        profileId: text(row.organization_id),
        profileName: text(row.profile_name),
        appearanceId: text(row.booking_id),
        message: "This dated appearance is linked to the operational calendar but its status is not booked/confirmed.",
        autoFixable: true,
        evidence: {
          status: text(row.status),
          googleEventId: text(row.google_event_id),
          calendarId: text(row.calendar_id),
          packageKey: text(row.package_key),
          startsAt: iso(row.starts_at),
          endsAt: iso(row.ends_at),
        },
      }));
    }

    for (const row of calendarOrphanResult.rows) {
      issues.push(issue({
        code: "calendar_link_missing_appearance",
        severity: "error",
        appearanceId: text(row.booking_id),
        message: "An operational calendar link points to a missing dated appearance record.",
        autoFixable: false,
        evidence: {
          linkId: text(row.link_id),
          googleEventId: text(row.google_event_id),
          calendarId: text(row.calendar_id),
          packageKey: text(row.package_key),
        },
      }));
    }

    for (const row of duplicateActActivityResult.rows) {
      issues.push(issue({
        code: "duplicate_act_timeline_record",
        severity: "warning",
        profileId: text(row.organization_id),
        profileName: text(row.profile_name),
        message: `${number(row.duplicate_count)} timeline rows share one ACT source record.`,
        autoFixable: false,
        evidence: {
          sourceType: text(row.source_type),
          sourceRecordId: text(row.source_record_id),
          activityIds: stringList(row.activity_ids),
        },
      }));
    }

    for (const row of timelineFallbackResult.rows) {
      issues.push(issue({
        code: "timeline_date_fallback",
        severity: "info",
        profileId: text(row.organization_id),
        profileName: text(row.profile_name),
        message: `${number(row.fallback_count)} imported timeline records do not have a trustworthy historical date.`,
        autoFixable: false,
        evidence: {
          activityIds: stringList(row.activity_ids),
          sourceTypes: stringList(row.source_types),
        },
      }));
    }

    for (const row of unownedActivityResult.rows) {
      issues.push(issue({
        code: "timeline_record_unowned",
        severity: "error",
        message: "A timeline record is not connected to a profile, contact, appearance, or imported relationship.",
        autoFixable: false,
        evidence: {
          activityId: text(row.activity_id),
          sourceType: text(row.source_type),
          sourceRecordId: text(row.source_record_id),
          occurredAt: iso(row.timeline_sort_at),
        },
      }));
    }

    for (const row of actLinkConflictResult.rows) {
      issues.push(issue({
        code: "act_source_link_conflict",
        severity: "error",
        message: "One ACT source record is marked primary for more than one local record.",
        autoFixable: false,
        evidence: {
          sourceEntityType: text(row.source_entity_type),
          actRecordId: text(row.act_record_id),
          entityType: text(row.entity_type),
          entityIds: stringList(row.entity_ids),
        },
      }));
    }

    const pendingGmailReviewCount = pendingGmailReviewResult.rows.reduce(
      (sum, row) => sum + number(row.pending_count),
      0,
    );
    if (pendingGmailReviewCount > 0) {
      issues.push(issue({
        code: "gmail_matches_need_review",
        severity: "warning",
        message: `${pendingGmailReviewCount} Gmail messages still need a profile assignment decision.`,
        autoFixable: false,
        evidence: { pendingCount: pendingGmailReviewCount },
      }));
    }

    const pendingCalendarReviewCount = pendingCalendarReviewResult.rows.reduce(
      (sum, row) => sum + number(row.pending_count),
      0,
    );
    if (pendingCalendarReviewCount > 0) {
      issues.push(issue({
        code: "calendar_matches_need_review",
        severity: "warning",
        message: `${pendingCalendarReviewCount} calendar events still need a profile/appearance match decision.`,
        autoFixable: false,
        evidence: { pendingCount: pendingCalendarReviewCount },
      }));
    }

    for (const profile of profiles) {
      if (!profile.actRecordId && profile.timelineCount > 0) {
        issues.push(issue({
          code: "profile_without_act_company_id",
          severity: "info",
          profileId: profile.id,
          profileName: profile.name,
          message: "This profile has relationship history but no direct ACT company ID. It may be intentionally manual or may need an ACT match.",
          autoFixable: false,
          evidence: {
            timelineCount: profile.timelineCount,
            appearanceCount: profile.appearanceCount,
            actAppearanceCount: profile.actAppearanceCount,
          },
        }));
      }
      if (profile.appearanceCount > 0 && !profile.latestTimelineAt) {
        issues.push(issue({
          code: "appearance_without_timeline",
          severity: "warning",
          profileId: profile.id,
          profileName: profile.name,
          message: "This profile has dated appearance records but no connected notes, calls, or ACT history.",
          autoFixable: false,
          evidence: { appearanceCount: profile.appearanceCount },
        }));
      }
    }

    issues.sort((left, right) => {
      const priority = { error: 0, warning: 1, info: 2 } as const;
      return priority[left.severity] - priority[right.severity]
        || (left.profileName ?? "").localeCompare(right.profileName ?? "")
        || left.code.localeCompare(right.code)
        || (left.appearanceId ?? "").localeCompare(right.appearanceId ?? "");
    });

    const errorCount = issues.filter((item) => item.severity === "error").length;
    const warningCount = issues.filter((item) => item.severity === "warning").length;
    const autoFixableCount = issues.filter((item) => item.autoFixable).length;

    return {
      ok: true,
      generatedAt: now.toISOString(),
      mode: "read_only",
      summary: {
        profileCount: profiles.length,
        profileWithActSourceCount: profiles.filter((profile) => profile.actRecordId).length,
        profileWithoutActSourceCount: profiles.filter((profile) => !profile.actRecordId).length,
        profileWithGmailCount: profiles.filter((profile) => profile.gmailThreadCount > 0).length,
        profileWithCalendarCount: profiles.filter((profile) => profile.calendarLinkCount > 0).length,
        issueCount: issues.length,
        errorCount,
        warningCount,
        autoFixableCount,
        reviewRequiredCount: issues.length - autoFixableCount,
        duplicateAppearanceGroupCount: duplicateAppearanceResult.rows.length,
        duplicateContactGroupCount: duplicateContactResult.rows.length,
        pendingGmailReviewCount,
        pendingCalendarReviewCount,
      },
      connections: {
        googleWorkspace: gmailConnectionResult.rows.map((row) => ({ ...row })),
        gmailValidation: gmailValidationResult.rows.map((row) => ({ ...row })),
      },
      profiles,
      issues,
    };
  }
}

const PROFILE_SUMMARY_SQL = `
WITH profile_contacts AS (
  SELECT relationship.organization_id,
         count(DISTINCT relationship.contact_id) FILTER (
           WHERE relationship.active
             AND NOT EXISTS (
               SELECT 1 FROM contact_consolidations mapping
               WHERE mapping.source_contact_id = relationship.contact_id
             )
         ) AS contact_count
    FROM organization_contacts relationship
   GROUP BY relationship.organization_id
), profile_appearances AS (
  SELECT booking.organization_id,
         count(*) AS appearance_count,
         count(booking.act_record_id) AS act_appearance_count
    FROM bookings booking
   WHERE NOT EXISTS (
           SELECT 1 FROM booking_consolidations mapping
           WHERE mapping.source_booking_id = booking.id
         )
     AND coalesce(booking.notes, '') NOT LIKE '[Merged duplicate] Canonical booking:%'
   GROUP BY booking.organization_id
), profile_timeline AS (
  SELECT owned.organization_id,
         count(DISTINCT owned.activity_id) AS timeline_count,
         min(owned.timeline_sort_at) AS first_timeline_at,
         max(owned.timeline_sort_at) AS latest_timeline_at
    FROM (
      SELECT a.id AS activity_id,
             coalesce(a.organization_id, b.organization_id, c.organization_id, aa.organization_id, ab.organization_id, ac.organization_id) AS organization_id,
             a.timeline_sort_at
        FROM activities a
        LEFT JOIN bookings b ON b.id = a.booking_id
        LEFT JOIN contacts c ON c.id = a.contact_id
        LEFT JOIN LATERAL (
          SELECT organization_id FROM activity_associations x
           WHERE x.activity_id = a.id AND x.organization_id IS NOT NULL LIMIT 1
        ) aa ON true
        LEFT JOIN LATERAL (
          SELECT b2.organization_id
            FROM activity_associations x
            JOIN bookings b2 ON b2.id = x.booking_id
           WHERE x.activity_id = a.id AND x.booking_id IS NOT NULL LIMIT 1
        ) ab ON true
        LEFT JOIN LATERAL (
          SELECT c2.organization_id
            FROM activity_associations x
            JOIN contacts c2 ON c2.id = x.contact_id
           WHERE x.activity_id = a.id AND x.contact_id IS NOT NULL LIMIT 1
        ) ac ON true
       WHERE a.deleted_at IS NULL
    ) owned
   WHERE owned.organization_id IS NOT NULL
   GROUP BY owned.organization_id
), profile_followups AS (
  SELECT coalesce(f.organization_id, b.organization_id, c.organization_id) AS organization_id,
         count(*) FILTER (WHERE f.completed_at IS NULL) AS open_follow_up_count
    FROM follow_ups f
    LEFT JOIN bookings b ON b.id = f.booking_id
    LEFT JOIN contacts c ON c.id = f.contact_id
   GROUP BY coalesce(f.organization_id, b.organization_id, c.organization_id)
), profile_gmail AS (
  SELECT m.organization_id, count(DISTINCT m.thread_id) AS gmail_thread_count
    FROM google_workspace_validation_mappings m
    JOIN google_workspace_validation_state s
      ON s.connection_id = m.connection_id
     AND s.validation_status = 'approved'
   GROUP BY m.organization_id
), profile_calendar AS (
  SELECT b.organization_id, count(DISTINCT l.id) AS calendar_link_count
    FROM google_operational_calendar_links l
    JOIN bookings b ON b.id = l.booking_id
   GROUP BY b.organization_id
), profile_calendar_reviews AS (
  SELECT b.organization_id, count(DISTINCT r.id) AS pending_calendar_review_count
    FROM google_operational_calendar_reviews r
    LEFT JOIN bookings b ON b.id = r.booking_id
   WHERE r.state = 'pending'
     AND b.organization_id IS NOT NULL
   GROUP BY b.organization_id
)
SELECT o.id::text,
       o.name,
       o.city,
       o.region,
       o.act_record_id,
       o.updated_at,
       coalesce(pc.contact_count, 0)::text AS contact_count,
       coalesce(pa.appearance_count, 0)::text AS appearance_count,
       coalesce(pa.act_appearance_count, 0)::text AS act_appearance_count,
       coalesce(pt.timeline_count, 0)::text AS timeline_count,
       pt.first_timeline_at,
       pt.latest_timeline_at,
       coalesce(pf.open_follow_up_count, 0)::text AS open_follow_up_count,
       coalesce(pg.gmail_thread_count, 0)::text AS gmail_thread_count,
       coalesce(pcal.calendar_link_count, 0)::text AS calendar_link_count,
       coalesce(pcr.pending_calendar_review_count, 0)::text AS pending_calendar_review_count
  FROM organizations o
  LEFT JOIN profile_contacts pc ON pc.organization_id = o.id
  LEFT JOIN profile_appearances pa ON pa.organization_id = o.id
  LEFT JOIN profile_timeline pt ON pt.organization_id = o.id
  LEFT JOIN profile_followups pf ON pf.organization_id = o.id
  LEFT JOIN profile_gmail pg ON pg.organization_id = o.id
  LEFT JOIN profile_calendar pcal ON pcal.organization_id = o.id
  LEFT JOIN profile_calendar_reviews pcr ON pcr.organization_id = o.id
 WHERE o.consolidated_into_id IS NULL
 ORDER BY lower(o.name), o.city NULLS LAST, o.region NULLS LAST, o.id`;

const DUPLICATE_APPEARANCE_SQL = `
WITH candidates AS (
  SELECT b.id,
         b.organization_id,
         o.name AS profile_name,
         b.name,
         regexp_replace(lower(coalesce(b.name, '')), '[^a-z0-9]+', '', 'g') AS normalized_name,
         lower(trim(coalesce(b.city, ''))) AS normalized_city,
         upper(trim(coalesce(b.region, ''))) AS normalized_region,
         b.starts_at::date AS starts_on,
         b.ends_at::date AS ends_on,
         b.status::text AS status,
         b.act_record_id
    FROM bookings b
    JOIN organizations o ON o.id = b.organization_id
   WHERE o.consolidated_into_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM booking_consolidations mapping
       WHERE mapping.source_booking_id = b.id
     )
     AND coalesce(b.notes, '') NOT LIKE '[Merged duplicate] Canonical booking:%'
)
SELECT organization_id::text,
       min(profile_name) AS profile_name,
       min(name) AS event_name,
       min(normalized_city) AS city,
       min(normalized_region) AS region,
       starts_on::text,
       ends_on::text,
       count(*)::text AS duplicate_count,
       array_agg(id::text ORDER BY id) AS appearance_ids,
       array_agg(status ORDER BY id) AS statuses,
       array_remove(array_agg(act_record_id ORDER BY id), NULL) AS act_record_ids
  FROM candidates
 GROUP BY organization_id, normalized_name, normalized_city, normalized_region, starts_on, ends_on
HAVING count(*) > 1
 ORDER BY min(profile_name), starts_on NULLS LAST, min(name)`;

const DUPLICATE_CONTACT_SQL = `
WITH candidates AS (
  SELECT oc.organization_id,
         o.name AS profile_name,
         c.id,
         trim(concat_ws(' ', c.first_name, c.last_name)) AS contact_name,
         lower(nullif(trim(c.email), '')) AS email,
         nullif(trim(c.normalized_phone), '') AS normalized_phone,
         c.act_record_id
    FROM organization_contacts oc
    JOIN organizations o ON o.id = oc.organization_id
    JOIN contacts c ON c.id = oc.contact_id
   WHERE oc.active = true
     AND o.consolidated_into_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM contact_consolidations mapping
       WHERE mapping.source_contact_id = c.id
     )
), grouped AS (
  SELECT organization_id,
         min(profile_name) AS profile_name,
         min(contact_name) AS contact_name,
         email,
         normalized_phone,
         count(*) AS duplicate_count,
         array_agg(id::text ORDER BY id) AS contact_ids,
         array_remove(array_agg(act_record_id ORDER BY id), NULL) AS act_record_ids
    FROM candidates
   WHERE email IS NOT NULL OR normalized_phone IS NOT NULL
   GROUP BY organization_id,
            regexp_replace(lower(contact_name), '[^a-z0-9]+', '', 'g'),
            email,
            normalized_phone
  HAVING count(*) > 1
)
SELECT organization_id::text,
       profile_name,
       contact_name,
       email,
       normalized_phone,
       duplicate_count::text,
       contact_ids,
       act_record_ids
  FROM grouped
 ORDER BY profile_name, contact_name`;

const GOOGLE_CONNECTION_SQL = `
SELECT account_email, role, status, connected_at, last_verified_at, last_error_code, updated_at
  FROM google_workspace_connections
 ORDER BY role, updated_at DESC`;

const GMAIL_VALIDATION_STATE_SQL = `
SELECT c.account_email,
       s.validation_status,
       s.reviewed_at,
       s.updated_at,
       count(m.message_id)::text AS mapped_message_count,
       count(DISTINCT m.thread_id)::text AS mapped_thread_count,
       count(DISTINCT m.organization_id)::text AS mapped_profile_count
  FROM google_workspace_validation_state s
  JOIN google_workspace_connections c ON c.id = s.connection_id
  LEFT JOIN google_workspace_validation_mappings m ON m.connection_id = s.connection_id
 GROUP BY c.account_email, s.validation_status, s.reviewed_at, s.updated_at
 ORDER BY s.updated_at DESC`;

const PENDING_GMAIL_REVIEW_SQL = `
SELECT connection_id::text, count(*)::text AS pending_count
  FROM google_workspace_validation_review_items
 WHERE review_state = 'pending'
 GROUP BY connection_id`;

const ORPHAN_GMAIL_MAPPING_SQL = `
SELECT m.organization_id::text,
       m.message_id,
       m.thread_id,
       o.consolidated_into_id::text
  FROM google_workspace_validation_mappings m
  LEFT JOIN organizations o ON o.id = m.organization_id
 WHERE o.id IS NULL OR o.consolidated_into_id IS NOT NULL
 ORDER BY m.organization_id, m.message_id`;

const CALENDAR_STATUS_MISMATCH_SQL = `
SELECT b.organization_id::text,
       o.name AS profile_name,
       b.id::text AS booking_id,
       b.status::text,
       b.starts_at,
       b.ends_at,
       l.google_event_id,
       l.calendar_id,
       l.package_key
  FROM google_operational_calendar_links l
  JOIN bookings b ON b.id = l.booking_id
  LEFT JOIN organizations o ON o.id = b.organization_id
 WHERE b.status::text NOT IN ('contract_received', 'confirmed', 'completed')
 ORDER BY o.name NULLS LAST, b.starts_at NULLS LAST, b.id`;

const ORPHAN_CALENDAR_LINK_SQL = `
SELECT l.id::text AS link_id,
       l.booking_id::text,
       l.google_event_id,
       l.calendar_id,
       l.package_key
  FROM google_operational_calendar_links l
  LEFT JOIN bookings b ON b.id = l.booking_id
 WHERE b.id IS NULL
 ORDER BY l.calendar_id, l.google_event_id`;

const PENDING_CALENDAR_REVIEW_SQL = `
SELECT connection_id::text, count(*)::text AS pending_count
  FROM google_operational_calendar_reviews
 WHERE state = 'pending'
 GROUP BY connection_id`;

const DUPLICATE_ACT_ACTIVITY_SQL = `
WITH owned AS (
  SELECT a.id,
         a.source_type,
         a.source_record_id,
         coalesce(a.organization_id, b.organization_id, c.organization_id, aa.organization_id) AS organization_id
    FROM activities a
    LEFT JOIN bookings b ON b.id = a.booking_id
    LEFT JOIN contacts c ON c.id = a.contact_id
    LEFT JOIN LATERAL (
      SELECT coalesce(x.organization_id, b2.organization_id, c2.organization_id) AS organization_id
        FROM activity_associations x
        LEFT JOIN bookings b2 ON b2.id = x.booking_id
        LEFT JOIN contacts c2 ON c2.id = x.contact_id
       WHERE x.activity_id = a.id
       ORDER BY x.id
       LIMIT 1
    ) aa ON true
   WHERE a.deleted_at IS NULL
     AND a.source_record_id IS NOT NULL
)
SELECT owned.organization_id::text,
       o.name AS profile_name,
       owned.source_type,
       owned.source_record_id,
       count(*)::text AS duplicate_count,
       array_agg(owned.id::text ORDER BY owned.id) AS activity_ids
  FROM owned
  LEFT JOIN organizations o ON o.id = owned.organization_id
 GROUP BY owned.organization_id, o.name, owned.source_type, owned.source_record_id
HAVING count(*) > 1
 ORDER BY o.name NULLS LAST, owned.source_type, owned.source_record_id`;

const TIMELINE_FALLBACK_SQL = `
WITH owned AS (
  SELECT a.id,
         a.source_type,
         coalesce(a.organization_id, b.organization_id, c.organization_id, aa.organization_id) AS organization_id
    FROM activities a
    LEFT JOIN bookings b ON b.id = a.booking_id
    LEFT JOIN contacts c ON c.id = a.contact_id
    LEFT JOIN LATERAL (
      SELECT coalesce(x.organization_id, b2.organization_id, c2.organization_id) AS organization_id
        FROM activity_associations x
        LEFT JOIN bookings b2 ON b2.id = x.booking_id
        LEFT JOIN contacts c2 ON c2.id = x.contact_id
       WHERE x.activity_id = a.id
       ORDER BY x.id
       LIMIT 1
    ) aa ON true
   WHERE a.deleted_at IS NULL
     AND a.date_is_import_fallback = true
)
SELECT owned.organization_id::text,
       o.name AS profile_name,
       count(*)::text AS fallback_count,
       array_agg(owned.id::text ORDER BY owned.id) AS activity_ids,
       array_remove(array_agg(DISTINCT owned.source_type), NULL) AS source_types
  FROM owned
  LEFT JOIN organizations o ON o.id = owned.organization_id
 GROUP BY owned.organization_id, o.name
 ORDER BY o.name NULLS LAST`;

const UNOWNED_ACTIVITY_SQL = `
SELECT a.id::text AS activity_id,
       a.source_type,
       a.source_record_id,
       a.timeline_sort_at
  FROM activities a
  LEFT JOIN bookings b ON b.id = a.booking_id
  LEFT JOIN contacts c ON c.id = a.contact_id
 WHERE a.deleted_at IS NULL
   AND a.organization_id IS NULL
   AND b.organization_id IS NULL
   AND c.organization_id IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM activity_associations x
       LEFT JOIN bookings b2 ON b2.id = x.booking_id
       LEFT JOIN contacts c2 ON c2.id = x.contact_id
      WHERE x.activity_id = a.id
        AND coalesce(x.organization_id, b2.organization_id, c2.organization_id) IS NOT NULL
   )
 ORDER BY a.timeline_sort_at DESC, a.id`;

const ACT_LINK_CONFLICT_SQL = `
SELECT source_entity_type,
       act_record_id,
       entity_type,
       count(*)::text AS duplicate_count,
       array_agg(entity_id::text ORDER BY entity_id) AS entity_ids
  FROM act_external_links
 WHERE is_primary = true
 GROUP BY source_entity_type, act_record_id, entity_type
HAVING count(*) > 1
 ORDER BY source_entity_type, act_record_id, entity_type`;
