/**
 * Imports Act! activities, notes, and history entries into the local activity
 * timeline after the main entity migration apply has completed.
 *
 * Each item is linked to the correct local contact / organisation by looking up
 * the Act! record ID in act_external_links. Duplicate re-runs are idempotent
 * because every imported row carries a unique actRecordId key that is covered
 * by a partial unique index.
 *
 * Association resolution runs two passes:
 *  1. Inline extraction — works for projected-mode responses where contact,
 *     company, and opportunity are returned as expanded objects. Also handles
 *     plain-mode records that include direct foreign-key fields (e.g. contactId
 *     / contactID as a GUID string).
 *  2. Relationship-endpoint fallback — when the inline pass finds nothing (plain
 *     mode responses that omit expansion entirely), the service calls the
 *     per-record relationship endpoints (e.g. /api/notes/{id}/contacts) to
 *     resolve the parent entity.
 *
 * Handles the projected-to-plain fallback: when the Act! endpoint does not
 * support OData projections it returns an empty page with queryMode "plain" as
 * a one-time signal to retry in unprojected mode (matching the pattern used by
 * the route scan and snapshot service).
 */

import { and, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { activities, actExternalLinks } from "@/db/schema";
import type { ActStreamType } from "@/features/act-migration/act-activity-parser";
import type { ActMigrationSourceClient } from "@/features/act-migration/source-client";

type DrizzleDatabase = typeof database;
type QueryMode = "projected" | "plain";

// ─── Raw value helpers ────────────────────────────────────────────────────────

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Extract the first `id` string from:
 * - A collection (array of objects with `id`)
 * - A singular object with `id`
 * - A direct GUID string (plain-mode direct-ID field like `contactId`)
 */
function extractFirstId(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecord(item)) {
        const id = str(item["id"]);
        if (id) return id;
      }
    }
    return null;
  }
  if (isRecord(value)) return str(value["id"]);
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

/**
 * Extract an Act! entity ID from a record, trying multiple field-name patterns
 * to handle both projected-mode (expanded objects) and plain-mode (direct ID
 * fields) responses.
 *
 * Patterns tried in order:
 *   1. Nested object(s): `raw[singularKey]` or `raw[pluralKey]` → extract id
 *   2. Direct camelCase FK: `raw["contactId"]` / `raw["companyId"]` etc.
 *   3. Direct PascalCase FK: `raw["contactID"]` / `raw["companyID"]` etc.
 */
function extractInlineId(
  raw: Record<string, unknown>,
  singularKey: string,   // e.g. "contact", "company", "opportunity"
  pluralKey: string,     // e.g. "contacts", "companies", "opportunities"
  directKeys: string[],  // e.g. ["contactId", "contactID"]
): string | null {
  // 1. Nested objects (projected mode)
  const fromSingular = extractFirstId(raw[singularKey]);
  if (fromSingular) return fromSingular;
  const fromPlural = extractFirstId(raw[pluralKey]);
  if (fromPlural) return fromPlural;
  // 2+3. Direct FK fields (plain mode)
  for (const key of directKeys) {
    const direct = str(raw[key]);
    if (direct) return direct;
  }
  return null;
}

function extractDate(raw: Record<string, unknown>, streamType: ActStreamType): Date | null {
  const dateStr =
    streamType === "activity"
      ? str(raw["scheduleDate"]) ?? str(raw["edited"])
      : str(raw["createDate"]) ?? str(raw["edited"]);
  if (!dateStr) return null;
  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractBody(raw: Record<string, unknown>, streamType: ActStreamType): string | null {
  const subject = str(raw["subject"]);
  const bodyField = streamType === "note" ? "body" : "details";
  const body = str(raw[bodyField]);
  const parts = [subject, body].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** Stable deduplication key stored on the activities row. */
function actRecordKey(streamType: ActStreamType, actId: string): string {
  return `act_${streamType}:${actId}`;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type ActivityImportStreamResult = {
  inserted: number;
  /** Row already existed — conflict suppressed by idempotency key. */
  skipped: number;
  /** No resolvable local parent entity (contact / org / booking). */
  unlinked: number;
  errors: number;
};

export type ActivityImportResult = {
  note: ActivityImportStreamResult;
  history: ActivityImportStreamResult;
  activity: ActivityImportStreamResult;
  /** Present when a non-retryable API or DB error stopped the import early. */
  errorMessage?: string;
};

// ─── Service ──────────────────────────────────────────────────────────────────

export class ActMigrationActivityImportService {
  constructor(
    private readonly client: ActMigrationSourceClient,
    private readonly db: DrizzleDatabase,
  ) {}

  /**
   * Import all three Act! streams (notes → history → activities).
   *
   * @param onStreamComplete — optional callback invoked after each stream
   *   finishes.  Use this to persist intermediate progress so the import is
   *   recoverable if the process is interrupted mid-run.  Errors thrown by the
   *   callback are swallowed to avoid masking the stream result.
   */
  async importAll(
    onStreamComplete?: (
      streamType: ActStreamType,
      result: ActivityImportStreamResult,
    ) => Promise<void>,
  ): Promise<ActivityImportResult> {
    const result: ActivityImportResult = {
      note: { inserted: 0, skipped: 0, unlinked: 0, errors: 0 },
      history: { inserted: 0, skipped: 0, unlinked: 0, errors: 0 },
      activity: { inserted: 0, skipped: 0, unlinked: 0, errors: 0 },
    };

    for (const streamType of ["note", "history", "activity"] as ActStreamType[]) {
      try {
        result[streamType] = await this.importStream(streamType);
      } catch (err: unknown) {
        // A fatal fetch failure stops this stream but does NOT abort other streams.
        const msg = err instanceof Error ? err.message : String(err);
        result.errorMessage =
          `Activity import failed on stream "${streamType}": ${msg}`;
      }
      // Persist intermediate progress after every stream — even failed ones —
      // so the run summary reflects real-time state and recovery is possible.
      try {
        await onStreamComplete?.(streamType, result[streamType]);
      } catch {
        // Never let a persistence callback mask the stream outcome.
      }
    }

    return result;
  }

  private async importStream(streamType: ActStreamType): Promise<ActivityImportStreamResult> {
    const streamResult: ActivityImportStreamResult = { inserted: 0, skipped: 0, unlinked: 0, errors: 0 };
    let skip = 0;
    const top = 100;
    // Start in projected mode; the source client signals a fallback to plain by
    // returning queryMode "plain" with an empty first page (see source-client.ts).
    let queryMode: QueryMode = "projected";

    for (;;) {
      const page = await this.fetchPage(streamType, skip, top, queryMode);

      // Projected-to-plain fallback: mode changed means the endpoint doesn't
      // support projections. Switch mode and retry the same page position.
      if (page.queryMode !== queryMode) {
        queryMode = page.queryMode as QueryMode;
        // nextSkip is preserved at the current skip; items will be empty — loop
        continue;
      }

      for (const item of page.items) {
        if (!isRecord(item)) continue;
        try {
          const outcome = await this.importItem(streamType, item);
          if (outcome === "inserted") streamResult.inserted++;
          else if (outcome === "skipped") streamResult.skipped++;
          else if (outcome === "unlinked") streamResult.unlinked++;
        } catch {
          streamResult.errors++;
        }
      }

      if (page.nextSkip === null) break;
      skip = page.nextSkip;
    }

    return streamResult;
  }

  private fetchPage(streamType: ActStreamType, skip: number, top: number, queryMode: QueryMode) {
    const request = { skip, top, queryMode };
    switch (streamType) {
      case "activity":
        return this.client.listActivities(request);
      case "note":
        return this.client.listNotes(request);
      case "history":
        return this.client.listHistory(request);
    }
  }

  /**
   * Import a single raw Act! item.
   * Returns:
   *   "inserted"  — new row written
   *   "skipped"   — idempotency conflict; already present from a prior run
   *   "unlinked"  — no resolvable local parent; not counted as a duplicate
   */
  private async importItem(
    streamType: ActStreamType,
    raw: Record<string, unknown>,
  ): Promise<"inserted" | "skipped" | "unlinked"> {
    const actId = str(raw["id"]);
    if (!actId) return "unlinked";

    const body = extractBody(raw, streamType);
    if (!body) return "unlinked";

    const actRecordId = actRecordKey(streamType, actId);
    const occurredAt = extractDate(raw, streamType) ?? new Date();

    // ── Pass 1: inline extraction ────────────────────────────────────────────
    // Works for projected-mode (nested expanded objects) and plain-mode records
    // that include direct foreign-key fields (e.g. contactId / contactID).
    let actContactId = extractInlineId(raw,
      "contact", "contacts",
      ["contactId", "contactID", "contactRecordID"],
    );
    let actCompanyId = extractInlineId(raw,
      "company", "companies",
      ["companyId", "companyID", "companyRecordID"],
    );
    let actOpportunityId = extractInlineId(raw,
      "opportunity", "opportunities",
      ["opportunityId", "opportunityID"],
    );

    // ── Pass 2: relationship-endpoint fallback ───────────────────────────────
    // Plain-mode responses may omit all association data. In that case, call
    // the per-record relationship endpoints to resolve the parent entity.
    if (!actContactId) {
      actContactId = await this.fetchRelatedId(streamType, actId, "contact");
    }
    if (!actCompanyId) {
      actCompanyId = await this.fetchRelatedId(streamType, actId, "company");
    }
    // Opportunity link: only attempt if the inline pass already found one, or
    // if we have a contact to correlate (avoid extra round-trips for plain mode).
    // We don't have a generic "listOpportunitiesForNote" endpoint, so skip
    // the fallback for opportunity — the booking link is best-effort.

    // ── Resolve local UUIDs ──────────────────────────────────────────────────
    // Opportunity → booking via act_external_links (entityType "booking", sourceEntityType "opportunity").
    const [contactId, organizationId, bookingId] = await Promise.all([
      actContactId ? this.resolveLocalId("contact", "contact", actContactId) : null,
      actCompanyId ? this.resolveLocalId("organization", "company", actCompanyId) : null,
      actOpportunityId ? this.resolveLocalId("booking", "opportunity", actOpportunityId) : null,
    ]);

    // Every activity must be linked to at least one local entity.
    // Return "unlinked" (not "skipped") so the caller can track the reason.
    if (!contactId && !organizationId && !bookingId) return "unlinked";

    const [inserted] = await this.db
      .insert(activities)
      .values({
        contactId,
        organizationId,
        bookingId,
        kind: "act_history",
        body,
        occurredAt,
        actRecordId,
      })
      .onConflictDoNothing()
      .returning({ id: activities.id });

    return inserted ? "inserted" : "skipped";
  }

  /**
   * Call the per-record relationship endpoint to get the first associated
   * contact or company when the inline record data has no association.
   * Best-effort: returns null on any error.
   */
  private async fetchRelatedId(
    streamType: ActStreamType,
    actId: string,
    relType: "contact" | "company",
  ): Promise<string | null> {
    try {
      const request = { skip: 0, top: 1, queryMode: "projected" as const };
      let page;
      if (relType === "contact") {
        switch (streamType) {
          case "note":     page = await this.client.listContactsForNote(actId, request); break;
          case "history":  page = await this.client.listContactsForHistory(actId, request); break;
          case "activity": page = await this.client.listContactsForActivity(actId, request); break;
        }
      } else {
        switch (streamType) {
          case "note":     page = await this.client.listCompaniesForNote(actId, request); break;
          case "history":  page = await this.client.listCompaniesForHistory(actId, request); break;
          case "activity": page = await this.client.listCompaniesForActivity(actId, request); break;
        }
      }
      return extractFirstId(page.items[0]);
    } catch {
      return null;
    }
  }

  private async resolveLocalId(
    entityType: "contact" | "organization" | "booking",
    sourceEntityType: "contact" | "company" | "opportunity",
    actRecordId: string,
  ): Promise<string | null> {
    const [link] = await this.db
      .select({ entityId: actExternalLinks.entityId })
      .from(actExternalLinks)
      .where(
        and(
          eq(actExternalLinks.entityType, entityType),
          eq(actExternalLinks.sourceEntityType, sourceEntityType),
          eq(actExternalLinks.actRecordId, actRecordId),
        ),
      )
      .limit(1);
    return link?.entityId ?? null;
  }
}
