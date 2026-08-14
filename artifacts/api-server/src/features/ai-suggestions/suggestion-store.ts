/**
 * DB-backed store for AI-generated booking suggestions.
 *
 * Suggestions are persisted to the `ai_booking_suggestions` table so they
 * survive server restarts/redeploys (Render restarts on every deploy and
 * spins down on idle). Accepted/dismissed state is preserved too.
 *
 * Deduplication happens on insert via a stable `dedupe_key` column with a
 * unique index — the same key logic the analyzer previously used in memory.
 */

export type HistorySuggestion = {
  id: string;
  /** ISO date string (YYYY-MM-DD) for the start of the suggested booking, or null */
  suggestedDate: string | null;
  /** ISO date string for the end, or null */
  suggestedDateEnd: string | null;
  /** Client or company name extracted from the source text */
  clientName: string | null;
  /** Short description of the trip / event type */
  tripDescription: string;
  /** Raw location string parsed by the AI (may contain "City, State") */
  location: string | null;
  /** AI confidence in the suggestion */
  confidence: "high" | "medium" | "low";
  /** Text snippet from the Act! record that prompted this suggestion */
  sourceSnippet: string;
  /** actRecordId of the source activity, if available */
  actRecordId: string | null;
  /** Lifecycle state */
  status: "pending" | "accepted" | "dismissed";
  /** UUID of the booking created on accept */
  bookingId: string | null;
  /** Matched source contact, when the analyzed record had one */
  contactId: string | null;
  /** Matched source organization (event profile), when the record had one */
  organizationId: string | null;
};

/**
 * Deduplication key for a suggestion. Two suggestions are considered the same
 * when they point at the same source record (actRecordId) or, failing that,
 * the same client on the same suggested start date.
 */
export function suggestionKey(
  s: Pick<
    HistorySuggestion,
    "actRecordId" | "suggestedDate" | "clientName" | "tripDescription"
  >,
): string {
  if (s.actRecordId) return `act:${s.actRecordId}|${s.suggestedDate}`;
  return `client:${(s.clientName ?? s.tripDescription).toLowerCase()}|${s.suggestedDate}`;
}

// DB access is imported lazily (same pattern as the routes) so importing this
// module never initialises a database connection as a side effect.
async function deps() {
  const [{ db }, schema, orm] = await Promise.all([
    import("@/db/client"),
    import("@/db/schema"),
    import("drizzle-orm"),
  ]);
  return { db: db as any, table: schema.aiBookingSuggestions, orm };
}

type SuggestionRow = HistorySuggestion & Record<string, unknown>;

function toSuggestion(row: SuggestionRow): HistorySuggestion {
  return {
    id: row.id,
    suggestedDate: row.suggestedDate,
    suggestedDateEnd: row.suggestedDateEnd,
    clientName: row.clientName,
    tripDescription: row.tripDescription,
    location: row.location,
    confidence: row.confidence,
    sourceSnippet: row.sourceSnippet,
    actRecordId: row.actRecordId,
    status: row.status,
    bookingId: row.bookingId,
    contactId: (row.contactId as string | null) ?? null,
    organizationId: (row.organizationId as string | null) ?? null,
  };
}

/** Removes all suggestions. Used by tests. */
export async function clearSuggestions(): Promise<void> {
  const { db, table } = await deps();
  await db.delete(table);
}

/**
 * Inserts a suggestion, deduplicating on the stable suggestion key.
 * Returns true when the suggestion was inserted, false when an existing
 * suggestion with the same key was already present (insert skipped).
 */
export async function addSuggestion(
  suggestion: HistorySuggestion,
): Promise<boolean> {
  const { db, table } = await deps();
  const inserted = await db
    .insert(table)
    .values({ ...suggestion, dedupeKey: suggestionKey(suggestion) })
    .onConflictDoNothing({ target: table.dedupeKey })
    .returning({ id: table.id });
  return inserted.length > 0;
}

export async function getSuggestions(): Promise<HistorySuggestion[]> {
  const { db, table, orm } = await deps();
  const rows = await db.select().from(table).orderBy(orm.asc(table.createdAt));
  return rows.map(toSuggestion);
}

export async function getSuggestion(
  id: string,
): Promise<HistorySuggestion | undefined> {
  const { db, table, orm } = await deps();
  const rows = await db.select().from(table).where(orm.eq(table.id, id));
  return rows.length > 0 ? toSuggestion(rows[0]) : undefined;
}

export async function updateSuggestion(
  id: string,
  patch: Partial<HistorySuggestion>,
): Promise<HistorySuggestion | null> {
  const { db, table, orm } = await deps();
  const rows = await db
    .update(table)
    .set({ ...patch, updatedAt: new Date() })
    .where(orm.eq(table.id, id))
    .returning();
  return rows.length > 0 ? toSuggestion(rows[0]) : null;
}
