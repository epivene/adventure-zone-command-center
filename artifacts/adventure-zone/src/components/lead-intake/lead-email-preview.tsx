import { useEffect, useRef, useState } from "react";
import type { LeadEmailPreview } from "@/features/lead-intake/lead-intake-client";

export function LeadEmailPreviewPanel({
  rowId,
  reviewVersion,
  invalidationKey = 0,
  load,
}: {
  rowId: string;
  reviewVersion: number;
  invalidationKey?: number;
  load: (rowId: string, reviewVersion: number) => Promise<LeadEmailPreview>;
}) {
  const [preview, setPreview] = useState<LeadEmailPreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestGeneration = useRef(0);

  useEffect(() => {
    requestGeneration.current += 1;
    setPreview(null);
    setError("");
    setLoading(false);
  }, [rowId, reviewVersion, invalidationKey]);

  async function refresh() {
    const generation = ++requestGeneration.current;
    try {
      setError("");
      setPreview(null);
      setLoading(true);
      const value = await load(rowId, reviewVersion);
      if (generation === requestGeneration.current) setPreview(value);
    } catch (cause) {
      if (generation === requestGeneration.current) {
        setError(cause instanceof Error ? cause.message : "Could not load the safe email preview.");
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }

  const conflicts = preview?.calendarConflictSummary.totalConflicts ?? 0;
  const records = preview?.calendarConflictSummary.totalEvidenceRecords ?? 0;
  const displayedRecords = preview?.calendarConflictSummary.displayedEvidenceRecords ?? 0;
  const evidenceTruncated = preview?.calendarConflictSummary.truncated ?? false;

  return <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
    <div><p className="text-sm font-bold uppercase tracking-wide text-orange-700">Safe email preview</p><p className="text-sm text-slate-600">This is server-owned. It never creates or sends a Gmail draft.</p></div>
    <button className="button-secondary w-fit" disabled={loading} onClick={() => void refresh()} type="button">{loading ? "Loading safe preview…" : "Load safe preview"}</button>
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    {preview ? <div className="grid gap-3 text-sm">
      <dl className="grid gap-1 sm:grid-cols-2">
        <div><dt className="font-semibold">Recipient</dt><dd>{preview.recipient}</dd></div>
        <div><dt className="font-semibold">Profile / event</dt><dd>{preview.profileName ?? "Unconfirmed"} / {preview.eventName}</dd></div>
        <div><dt className="font-semibold">Source row</dt><dd>{preview.sourceRowId}</dd></div>
        <div><dt className="font-semibold">Evidence versions</dt><dd>Row {preview.rowVersion} / snapshot {preview.snapshotVersion ?? "none"}</dd></div>
        <div><dt className="font-semibold">Verified dates</dt><dd>{preview.verifiedDateRange.startDate} – {preview.verifiedDateRange.endDate}</dd></div>
        <div><dt className="font-semibold">Calendar evidence</dt><dd>{conflicts} {conflicts === 1 ? "conflict" : "conflicts"} across {records} sanitized {records === 1 ? "record" : "records"}{evidenceTruncated ? ` (showing ${displayedRecords})` : ""}</dd></div>
        <div><dt className="font-semibold">Review approvals</dt><dd>{(preview.relationshipStatus ?? "unreviewed").replaceAll("_", " ")} / {preview.territoryStatus ?? "unreviewed"} / {preview.fitStatus ?? "unreviewed"}</dd></div>
        <div><dt className="font-semibold">Approved template</dt><dd>{preview.templateVersion && preview.templateSource ? `${preview.templateVersion} — ${preview.templateSource}` : "Unavailable"}</dd></div>
        <div><dt className="font-semibold">Normal packages</dt><dd>{preview.normalPackageCounts.map((item) => `${item.packageKey}: ${item.availableQuantity}`).join(", ") || "None"}</dd></div>
        <div><dt className="font-semibold">Readiness</dt><dd>{preview.readiness.ready ? "Ready for future draft boundary" : preview.readiness.blockers.join(", ")}</dd></div>
      </dl>
      {preview.subject && preview.body ? <><p><span className="font-semibold">Subject:</span> {preview.subject}</p><pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans">{preview.body}</pre></> : <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 font-semibold text-amber-900">Normal rendered copy is withheld until every server-side blocker is resolved.</p>}
    </div> : null}
  </section>;
}
