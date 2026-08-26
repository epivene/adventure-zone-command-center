import { useEffect, useState } from "react";

export function LeadReviewStatusControls({ row, save }: { row: { id: string; reviewVersion: number; territoryStatus?: string; fitStatus?: string }; save: (input: { expectedVersion: number; territoryStatus: string; fitStatus: string }) => Promise<unknown> }) {
  const [territoryStatus, setTerritoryStatus] = useState(row.territoryStatus ?? "needs_review");
  const [fitStatus, setFitStatus] = useState(row.fitStatus ?? "needs_review");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setTerritoryStatus(row.territoryStatus ?? "needs_review");
    setFitStatus(row.fitStatus ?? "needs_review");
    setNotice("");
    setError("");
  }, [row.id, row.reviewVersion, row.territoryStatus, row.fitStatus]);
  async function persist() {
    try {
      setPending(true); setError(""); setNotice("");
      await save({ expectedVersion: row.reviewVersion, territoryStatus, fitStatus });
      setNotice("Review status saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save territory and fit.");
    } finally { setPending(false); }
  }
  return <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
    <div><p className="text-sm font-bold uppercase tracking-wide text-orange-700">Territory and fit review</p><p className="text-sm text-slate-600">Only open territory and approved fit can become draft-ready.</p></div>
    <label>Territory<select value={territoryStatus} onChange={(event) => setTerritoryStatus(event.target.value)}><option value="needs_review">Needs review</option><option value="open">Open</option><option value="ask_amy_dave">Ask Amy/Dave</option><option value="closed">Closed</option><option value="licensing_issue">Licensing issue</option></select></label>
    <label>Fit<select value={fitStatus} onChange={(event) => setFitStatus(event.target.value)}><option value="needs_review">Needs review</option><option value="approved">Approved</option><option value="not_a_fit">Not a fit</option></select></label>
    <button className="button-secondary w-fit" disabled={pending} onClick={() => void persist()} type="button">Save territory and fit</button>
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-emerald-700">{notice}</p> : null}
  </section>;
}
