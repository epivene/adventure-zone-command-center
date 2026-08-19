import { useEffect, useState } from "react";

import {
  analyzeProfileHistory,
  decideDerivedFact,
  listProfileDerivedFacts,
  type DerivedFactReviewItem,
} from "@/features/assistant/assistant-api";

function prettyKind(kind: string) {
  if (kind === "historical_price") return "historical price";
  return kind.replaceAll("_", " ");
}

export function DerivedFactsReview({ organizationId }: { organizationId: string }) {
  const [facts, setFacts] = useState<DerivedFactReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setFacts(await listProfileDerivedFacts(organizationId, "proposed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load assistant history analysis.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  async function analyze() {
    setAnalyzing(true);
    setMessage(null);
    setError(null);
    try {
      const result = await analyzeProfileHistory(organizationId);
      setMessage(
        result.activityCount === 0
          ? "There was no imported history available to analyze."
          : `Reviewed ${result.activityCount} relevant ACT history items and found ${result.candidateCount} possible fact${result.candidateCount === 1 ? "" : "s"}.`,
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not analyze imported history right now.",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  async function decide(factId: string, status: "confirmed" | "dismissed") {
    setError(null);
    try {
      await decideDerivedFact(factId, status);
      setFacts((current) => current.filter((fact) => fact.id !== factId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that review decision.");
    }
  }

  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer font-semibold text-slate-800">
        Assistant history analysis{facts.length ? ` (${facts.length} to review)` : ""}
      </summary>
      <div className="mt-4 grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-600">
              Analyze imported ACT! notes/history for useful booking facts. Pricing, package, setup, water, power, and load-out details are prioritized even when they are in older notes. Original ACT! records are never changed.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Findings stay proposed until you confirm them. Historical prices are never treated as current quotes automatically.
            </p>
          </div>
          <button
            className="button-secondary"
            disabled={analyzing}
            onClick={() => void analyze()}
            type="button"
          >
            {analyzing ? "Analyzing…" : "Analyze ACT history"}
          </button>
        </div>

        {message ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Loading proposed facts…</p>
        ) : facts.length === 0 ? (
          <p className="text-sm text-slate-500">No proposed assistant facts need review right now.</p>
        ) : (
          <ul className="grid gap-3">
            {facts.map((fact) => (
              <li className="rounded-lg border border-slate-200 p-3" key={fact.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-orange-700">
                      {prettyKind(fact.factKind)} · {fact.confidence} confidence
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{fact.summary}</p>
                    {fact.sourceActivityId ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Source activity: {fact.sourceActivityId}
                        {fact.sourceVersionId ? " · ACT source version preserved" : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="button-secondary"
                      onClick={() => void decide(fact.id, "dismissed")}
                      type="button"
                    >
                      Dismiss
                    </button>
                    <button
                      className="button-primary"
                      onClick={() => void decide(fact.id, "confirmed")}
                      type="button"
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
