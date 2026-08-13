/**
 * HistorySuggestions — streams AI analysis of Act! history and lets the
 * owner review, accept, or dismiss each suggested future booking.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { apiFetch, apiPost } from "@/lib/auth-token";

// ─── Types ─────────────────────────────────────────────────────────────────

export type HistorySuggestion = {
  id: string;
  suggestedDate: string | null;
  suggestedDateEnd: string | null;
  clientName: string | null;
  tripDescription: string;
  location: string | null;
  confidence: "high" | "medium" | "low";
  sourceSnippet: string;
  actRecordId: string | null;
  status: "pending" | "accepted" | "dismissed";
  bookingId: string | null;
};

type AnalysisState =
  | { phase: "idle" }
  | { phase: "running"; recordsFetched: number; batchIndex: number; totalBatches: number; suggestionsFound: number }
  | { phase: "done"; totalRecords: number; totalSuggestions: number; hadErrors: boolean; errors: string[] }
  | { phase: "error"; message: string };

// ─── Helpers ───────────────────────────────────────────────────────────────

const CONFIDENCE_ORDER: Record<HistorySuggestion["confidence"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const CONFIDENCE_PILL: Record<HistorySuggestion["confidence"], string> = {
  high: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-600",
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── SuggestionCard ────────────────────────────────────────────────────────

function SuggestionCard({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: HistorySuggestion;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [busy, setBusy] = useState<"accept" | "dismiss" | null>(null);

  const dateRange =
    suggestion.suggestedDate && suggestion.suggestedDateEnd
      ? `${formatDate(suggestion.suggestedDate)} – ${formatDate(suggestion.suggestedDateEnd)}`
      : suggestion.suggestedDate
        ? formatDate(suggestion.suggestedDate)
        : null;

  return (
    <div
      className={`rounded-xl border bg-white p-5 shadow-sm transition-all ${
        suggestion.status === "accepted"
          ? "border-emerald-300 bg-emerald-50 opacity-70"
          : suggestion.status === "dismissed"
            ? "border-slate-200 opacity-40"
            : "border-slate-200 hover:border-slate-300"
      }`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 leading-snug">
            {suggestion.clientName && (
              <span className="text-orange-700">{suggestion.clientName} — </span>
            )}
            {suggestion.tripDescription}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-slate-500">
            {dateRange && <span>📅 {dateRange}</span>}
            {suggestion.location && <span>📍 {suggestion.location}</span>}
          </div>
        </div>
        <span
          className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${CONFIDENCE_PILL[suggestion.confidence]}`}
        >
          {suggestion.confidence}
        </span>
      </div>

      {/* Source snippet */}
      <blockquote className="mt-3 border-l-2 border-slate-200 pl-3 text-sm italic text-slate-500 line-clamp-2">
        "{suggestion.sourceSnippet}"
      </blockquote>

      {/* Actions / status */}
      <div className="mt-4 flex items-center gap-3">
        {suggestion.status === "pending" ? (
          <>
            <button
              disabled={busy !== null}
              onClick={() => {
                setBusy("accept");
                onAccept(suggestion.id);
              }}
              className="rounded-lg bg-orange-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {busy === "accept" ? "Saving…" : "Accept → Create booking"}
            </button>
            <button
              disabled={busy !== null}
              onClick={() => {
                setBusy("dismiss");
                onDismiss(suggestion.id);
              }}
              className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              Dismiss
            </button>
          </>
        ) : suggestion.status === "accepted" ? (
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <span>✓ Draft booking created</span>
            {suggestion.bookingId && (
              <Link
                href={`/bookings/${suggestion.bookingId}`}
                className="font-semibold underline"
              >
                View booking →
              </Link>
            )}
          </div>
        ) : (
          <span className="text-sm text-slate-400">Dismissed</span>
        )}
      </div>
    </div>
  );
}

// ─── HistorySuggestions ────────────────────────────────────────────────────

export function HistorySuggestions() {
  const [state, setState] = useState<AnalysisState>({ phase: "idle" });
  const [suggestions, setSuggestions] = useState<HistorySuggestion[]>([]);
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const abortRef = useRef<AbortController | null>(null);

  const startAnalysis = useCallback(async () => {
    if (state.phase === "running") return;
    setSuggestions([]);
    setState({ phase: "running", recordsFetched: 0, batchIndex: 0, totalBatches: 0, suggestionsFound: 0 });

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      // apiFetch reads the token from az_owner_token and resolves the API
      // root (including VITE_API_BASE_URL for deployed configurations).
      const resp = await apiFetch("/ai-suggestions/analyze", {
        method: "POST",
        signal: abort.signal,
      });

      if (!resp.ok || !resp.body) {
        // Try to parse a JSON { error } body (e.g. 503 when no AI key is set);
        // fall back to raw text so the message is always readable.
        const raw = await resp.text().catch(() => "");
        let message = raw || `HTTP ${resp.status}`;
        try {
          const parsed = JSON.parse(raw) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch { /* not JSON */ }
        setState({ phase: "error", message });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (event.type === "fetched") {
              setState((s) =>
                s.phase === "running"
                  ? { ...s, recordsFetched: (event.count as number) ?? 0 }
                  : s,
              );
            } else if (event.type === "progress") {
              setState((s) =>
                s.phase === "running"
                  ? {
                      ...s,
                      batchIndex: (event.batchIndex as number) ?? 0,
                      totalBatches: (event.totalBatches as number) ?? 0,
                      suggestionsFound: (event.suggestionsFound as number) ?? 0,
                    }
                  : s,
              );
            } else if (event.type === "suggestion") {
              const sugg = event.suggestion as HistorySuggestion;
              setSuggestions((prev) => [...prev, sugg]);
            } else if (event.type === "done") {
              setState({
                phase: "done",
                totalRecords: (event.totalRecords as number) ?? 0,
                totalSuggestions: (event.totalSuggestions as number) ?? 0,
                hadErrors: (event.hadErrors as boolean) ?? false,
                errors: Array.isArray(event.errors) ? (event.errors as string[]) : [],
              });
            } else if (event.type === "error") {
              setState({ phase: "error", message: (event.message as string) ?? "Unknown error" });
            }
          } catch {
            // malformed SSE line, skip
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState({ phase: "error", message: (err as Error).message ?? "Analysis failed" });
    }
  }, [state.phase]);

  // Cleanup on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleAccept = useCallback(async (id: string) => {
    try {
      const { suggestion, booking } = await apiPost<{
        suggestion: HistorySuggestion;
        booking: { id: string };
      }>(`/ai-suggestions/${id}/accept`, {});
      setSuggestions((prev) => prev.map((s) => (s.id === id ? suggestion : s)));
      void booking; // bookingId stored in suggestion
    } catch (err) {
      alert(`Could not create booking: ${(err as Error).message}`);
    }
  }, []);

  const handleDismiss = useCallback(async (id: string) => {
    try {
      const { suggestion } = await apiPost<{ suggestion: HistorySuggestion }>(
        `/ai-suggestions/${id}/dismiss`,
        {},
      );
      setSuggestions((prev) => prev.map((s) => (s.id === id ? suggestion : s)));
    } catch (err) {
      alert(`Could not dismiss: ${(err as Error).message}`);
    }
  }, []);

  const visibleSuggestions = suggestions
    .filter((s) => filter === "all" || s.confidence === filter)
    .sort(
      (a, b) =>
        CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence],
    );

  const pending = suggestions.filter((s) => s.status === "pending").length;

  // ─── Idle state: just the button ──────────────────────────────────────────
  if (state.phase === "idle") {
    return (
      <button
        onClick={() => void startAnalysis()}
        className="flex items-center gap-2 rounded-lg border border-dashed border-orange-300 bg-orange-50 px-4 py-2.5 text-sm font-semibold text-orange-700 hover:bg-orange-100 transition-colors"
      >
        <span>✦</span> Suggest bookings from Act! history
      </button>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header + Run Again */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-800">
          AI Booking Suggestions
        </h2>
        <button
          onClick={() => void startAnalysis()}
          disabled={state.phase === "running"}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {state.phase === "running" ? "Analyzing…" : "Re-analyze"}
        </button>
      </div>

      {/* Progress bar */}
      {state.phase === "running" && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-2">
          <div className="flex justify-between text-sm text-orange-700">
            <span>
              {state.totalBatches > 0
                ? `Analyzing batch ${state.batchIndex + 1} of ${state.totalBatches} (${state.recordsFetched} records)`
                : `Fetched ${state.recordsFetched} records…`}
            </span>
            <span>{state.suggestionsFound} found so far</span>
          </div>
          {state.totalBatches > 0 && (
            <div className="h-1.5 overflow-hidden rounded-full bg-orange-200">
              <div
                className="h-full rounded-full bg-orange-500 transition-all"
                style={{
                  width: `${Math.round(((state.batchIndex + 1) / state.totalBatches) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Done / error summary */}
      {state.phase === "done" && !state.hadErrors && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          Analysis complete — scanned {state.totalRecords} records, found{" "}
          {state.totalSuggestions} suggestion{state.totalSuggestions !== 1 ? "s" : ""}.
          {pending > 0 && (
            <span className="ml-1 font-semibold">{pending} awaiting review.</span>
          )}
        </div>
      )}

      {state.phase === "done" && state.hadErrors && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-1">
          <p className="font-semibold">
            Analysis finished with errors — results may be incomplete.
          </p>
          <p>
            Scanned {state.totalRecords} records, found {state.totalSuggestions} suggestion
            {state.totalSuggestions !== 1 ? "s" : ""}.
            {state.errors.length > 0 && (
              <span className="ml-1">Failed batches: {state.errors.join("; ")}</span>
            )}
          </p>
        </div>
      )}

      {state.phase === "error" && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {state.message}
        </div>
      )}

      {/* Confidence filter */}
      {suggestions.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {(["all", "high", "medium", "low"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                filter === f
                  ? "bg-orange-600 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f === "all"
                ? `All (${suggestions.length})`
                : `${f} (${suggestions.filter((s) => s.confidence === f).length})`}
            </button>
          ))}
        </div>
      )}

      {/* Suggestion cards */}
      {visibleSuggestions.length > 0 ? (
        <div className="space-y-3">
          {visibleSuggestions.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              onAccept={(id) => void handleAccept(id)}
              onDismiss={(id) => void handleDismiss(id)}
            />
          ))}
        </div>
      ) : state.phase === "done" && suggestions.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No future booking suggestions found in the last 12 months of history.
        </p>
      ) : null}
    </div>
  );
}
