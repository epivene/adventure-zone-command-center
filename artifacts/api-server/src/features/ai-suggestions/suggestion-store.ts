/**
 * In-memory session store for AI-generated booking suggestions.
 *
 * Single-owner app — one global store is sufficient; suggestions expire
 * when the server restarts.  No DB write is needed until the owner accepts.
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
};

// Global store — keyed by suggestion id
const store = new Map<string, HistorySuggestion>();

export function clearSuggestions(): void {
  store.clear();
}

export function addSuggestion(suggestion: HistorySuggestion): void {
  store.set(suggestion.id, suggestion);
}

export function getSuggestions(): HistorySuggestion[] {
  return [...store.values()];
}

export function getSuggestion(id: string): HistorySuggestion | undefined {
  return store.get(id);
}

export function updateSuggestion(
  id: string,
  patch: Partial<HistorySuggestion>,
): HistorySuggestion | null {
  const existing = store.get(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  store.set(id, updated);
  return updated;
}
