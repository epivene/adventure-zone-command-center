import { useEffect, useState } from "react";

import { apiGet, apiPost } from "@/lib/auth-token";

type Candidate = {
  id: string;
  sourceName: string;
  yearBuilt: number;
  make: string;
  model: string;
  serialNumber: string;
  matchedResourceId: string | null;
  matchState: "pending" | "exact_match" | "applied" | "ignored";
  matchNote: string | null;
};

type Resource = {
  id: string;
  name: string;
  status: string;
  yearBuilt?: number | null;
  make?: string | null;
  model?: string | null;
  serialNumber?: string | null;
};

export function ResourceSourceCandidateReview() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await apiGet<{ candidates: Candidate[]; resources: Resource[] }>(
        "/settings/resource-source-candidates",
      );
      setCandidates(data.candidates ?? []);
      setResources((data.resources ?? []).filter((resource) => resource.status !== "archived"));
      setSelected((current) => {
        const next = { ...current };
        for (const candidate of data.candidates ?? []) {
          if (!next[candidate.id] && candidate.matchedResourceId) {
            next[candidate.id] = candidate.matchedResourceId;
          }
        }
        return next;
      });
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load imported asset details.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function link(candidate: Candidate) {
    const resourceId = selected[candidate.id];
    if (!resourceId || busy) return;
    setBusy(candidate.id);
    setError("");
    try {
      await apiPost(`/settings/resource-source-candidates/${candidate.id}/link`, { resourceId });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not link this imported asset.");
    } finally {
      setBusy(null);
    }
  }

  async function ignore(candidate: Candidate) {
    if (busy) return;
    const reason = window.prompt(`Why should “${candidate.sourceName}” be ignored?`);
    if (!reason?.trim()) return;
    setBusy(candidate.id);
    setError("");
    try {
      await apiPost(`/settings/resource-source-candidates/${candidate.id}/ignore`, { reason: reason.trim() });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not ignore this imported asset.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="grid gap-4">
      <div>
        <h3 className="text-lg font-bold">Imported asset details</h3>
        <p className="mt-1 text-sm text-slate-600">
          These nine identities came from the reviewed Inflatable List. Exact unique name matches can fill blank identity fields; uncertain or conflicting matches stay here for review.
        </p>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading imported asset details…</p> : null}
      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}

      {!loading && candidates.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-slate-600">No imported asset details need review.</p>
      ) : null}

      <div className="grid gap-3">
        {candidates.map((candidate) => {
          const suggested = candidate.matchedResourceId
            ? resources.find((resource) => resource.id === candidate.matchedResourceId) ?? null
            : null;
          return (
            <article className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4" key={candidate.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="font-bold">{candidate.sourceName}</h4>
                  <p className="text-xs text-slate-500">Source serial {candidate.serialNumber}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold capitalize">
                  {candidate.matchState.replaceAll("_", " ")}
                </span>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-4">
                <div><dt className="font-semibold">Year built</dt><dd>{candidate.yearBuilt}</dd></div>
                <div><dt className="font-semibold">Make</dt><dd>{candidate.make}</dd></div>
                <div><dt className="font-semibold">Model</dt><dd>{candidate.model}</dd></div>
                <div><dt className="font-semibold">Serial number</dt><dd>{candidate.serialNumber}</dd></div>
              </dl>
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <p><span className="font-semibold">Suggested match:</span> {suggested?.name ?? "None"}</p>
                {candidate.matchNote ? <p className="mt-1 text-slate-600">{candidate.matchNote}</p> : null}
              </div>

              {candidate.matchState === "pending" || candidate.matchState === "exact_match" ? (
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                  <label className="grid gap-1 text-sm font-semibold">
                    Existing resource
                    <select
                      onChange={(event) => setSelected((current) => ({ ...current, [candidate.id]: event.currentTarget.value }))}
                      value={selected[candidate.id] ?? ""}
                    >
                      <option value="">Choose resource</option>
                      {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
                    </select>
                  </label>
                  <button className="button-primary" disabled={!selected[candidate.id] || busy !== null} onClick={() => void link(candidate)} type="button">
                    {busy === candidate.id ? "Working…" : "Link"}
                  </button>
                  <button className="button-secondary" disabled={busy !== null} onClick={() => void ignore(candidate)} type="button">Ignore</button>
                </div>
              ) : null}

              {candidate.matchState === "pending" && !candidate.matchedResourceId ? (
                <p className="text-sm text-slate-600">
                  No real resource yet? <a className="link font-semibold" href="#create-resource-form">Create a normal resource</a> with the full operational form, then come back here and Link it.
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
