import { useState } from "react";
import type { LeadEmailPreview } from "@/features/lead-intake/lead-intake-client";

export function LeadEmailPreviewPanel({ rowId, reviewVersion, load }: { rowId: string; reviewVersion: number; load: (rowId: string, reviewVersion: number) => Promise<LeadEmailPreview> }) {
  const [preview, setPreview] = useState<LeadEmailPreview | null>(null);
  const [error, setError] = useState("");
  async function refresh() {
    try { setError(""); setPreview(await load(rowId, reviewVersion)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load the safe email preview."); }
  }
  return <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
    <div><p className="text-sm font-bold uppercase tracking-wide text-orange-700">Safe email preview</p><p className="text-sm text-slate-600">This is server-owned. It never creates or sends a Gmail draft.</p></div>
    <button className="button-secondary w-fit" onClick={() => void refresh()} type="button">Load safe preview</button>
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    {preview ? <div className="grid gap-3 text-sm">
      <dl className="grid gap-1 sm:grid-cols-2"><div><dt className="font-semibold">Recipient</dt><dd>{preview.recipient}</dd></div><div><dt className="font-semibold">Profile / event</dt><dd>{preview.profileName ?? "Unconfirmed"} / {preview.eventName}</dd></div><div><dt className="font-semibold">Verified dates</dt><dd>{preview.dateRange.startDate} – {preview.dateRange.endDate}</dd></div><div><dt className="font-semibold">Calendar evidence</dt><dd>{preview.calendarEvidence.length} record(s)</dd></div><div><dt className="font-semibold">Normal packages</dt><dd>{preview.packageAvailability?.packages?.map((item) => `${item.packageKey}: ${item.availableQuantity}`).join(", ") || "None"}</dd></div><div><dt className="font-semibold">Readiness</dt><dd>{preview.readiness.ready ? "Ready for future draft boundary" : preview.readiness.blockers.join(", ")}</dd></div></dl>
      {preview.subject && preview.body ? <><p><span className="font-semibold">Subject:</span> {preview.subject}</p><pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans">{preview.body}</pre></> : <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 font-semibold text-amber-900">Normal rendered copy is withheld until every server-side blocker is resolved.</p>}
    </div> : null}
  </section>;
}
