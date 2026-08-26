import { useEffect, useRef, useState } from "react";
import type { LeadEmailPreview, LeadGmailDraftLink } from "@/features/lead-intake/lead-intake-client";

export function LeadEmailPreviewPanel({
  rowId, reviewVersion, invalidationKey = 0, load, loadDraft, create,
}: {
  rowId: string; reviewVersion: number; invalidationKey?: number;
  load: (rowId: string, reviewVersion: number) => Promise<LeadEmailPreview>;
  loadDraft?: (rowId: string) => Promise<LeadGmailDraftLink | null>;
  create?: (rowId: string, reviewVersion: number) => Promise<{ link: LeadGmailDraftLink; reused: boolean }>;
}) {
  const [preview, setPreview] = useState<LeadEmailPreview | null>(null);
  const [draft, setDraft] = useState<LeadGmailDraftLink | null>(null);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false); const requestGeneration = useRef(0);
  const draftRequestGeneration = useRef(0);

  useEffect(() => {
    requestGeneration.current += 1;
    const draftGeneration = ++draftRequestGeneration.current;
    setPreview(null); setDraft(null); setError(""); setLoading(false); setCreating(false);
    if (loadDraft) {
      void loadDraft(rowId)
        .then((value) => { if (draftGeneration === draftRequestGeneration.current) setDraft(value); })
        .catch((cause) => {
          if (draftGeneration === draftRequestGeneration.current) setError(cause instanceof Error ? cause.message : "Could not load the Gmail draft state.");
        });
    }
  }, [rowId, reviewVersion, invalidationKey, loadDraft]);

  async function refresh() {
    const generation = ++requestGeneration.current;
    try { setError(""); setPreview(null); setLoading(true); const value = await load(rowId, reviewVersion); if (generation === requestGeneration.current) setPreview(value); }
    catch (cause) { if (generation === requestGeneration.current) setError(cause instanceof Error ? cause.message : "Could not load the safe email preview."); }
    finally { if (generation === requestGeneration.current) setLoading(false); }
  }
  async function createDraft() {
    if (!create) return;
    try { setError(""); setCreating(true); const result = await create(rowId, reviewVersion); setDraft(result.link); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the Gmail draft.");
      if (loadDraft) {
        try { setDraft(await loadDraft(rowId)); } catch { /* preserve the mutation error */ }
      }
    }
    finally { setCreating(false); }
  }

  const conflicts = preview?.calendarConflictSummary.totalConflicts ?? 0;
  const records = preview?.calendarConflictSummary.totalEvidenceRecords ?? 0;
  const displayedRecords = preview?.calendarConflictSummary.displayedEvidenceRecords ?? 0;
  const evidenceTruncated = preview?.calendarConflictSummary.truncated ?? false;
  const canCreate = Boolean(create && preview?.readiness.ready && preview.subject && preview.body && (!draft || draft.state === "retryable_error"));
  const draftStatus = draft
    ? draft.state === "created"
      ? "Gmail draft created"
      : draft.state === "manual_review" || draft.state === "prepared"
        ? "Gmail draft requires manual review"
        : "Gmail draft creation can be retried"
    : null;

  return <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
    <div><p className="text-sm font-bold uppercase tracking-wide text-orange-700">Safe email preview</p><p className="text-sm text-slate-600">The server rechecks every safety gate before creating one Gmail draft. It never sends email.</p></div>
    <button className="button-secondary w-fit" disabled={loading || creating} onClick={() => void refresh()} type="button">{loading ? "Loading safe preview…" : "Load safe preview"}</button>
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    {draftStatus ? <p role="status" className={draft?.state === "created" ? "rounded-lg border border-emerald-200 bg-emerald-50 p-3 font-semibold text-emerald-800" : "rounded-lg border border-amber-200 bg-amber-50 p-3 font-semibold text-amber-900"}>{draftStatus}</p> : null}
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
        <div><dt className="font-semibold">Readiness</dt><dd>{preview.readiness.ready ? "Ready for Gmail draft creation" : preview.readiness.blockers.join(", ")}</dd></div>
      </dl>
      {preview.subject && preview.body ? <><p><span className="font-semibold">Subject:</span> {preview.subject}</p><pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans">{preview.body}</pre></> : <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 font-semibold text-amber-900">Normal rendered copy is withheld until every server-side blocker is resolved.</p>}
      {canCreate ? <button className="button-primary w-fit" disabled={creating} onClick={() => void createDraft()} type="button">{creating ? "Creating Gmail draft…" : "Create Gmail Draft"}</button> : null}
    </div> : null}
  </section>;
}
