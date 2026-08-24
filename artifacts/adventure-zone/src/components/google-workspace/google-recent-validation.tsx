import { useState } from "react";

import { GoogleValidationReview } from "@/components/google-workspace/google-validation-review";
import {
  decideGoogleWorkspaceValidationSample,
  type GoogleRecentValidationResult,
  type GoogleRecentValidationRow,
  type GoogleValidationStatus,
} from "@/features/google-workspace/google-workspace-client";

const evidenceLabels: Record<string, string> = {
  exact_contact_email: "Exact contact email",
  contact_active_organization: "Contact's active profile",
  contact_organization_ambiguous: "Contact belongs to multiple profiles",
  contact_organization_unresolved: "Contact has no active profile",
  multiple_exact_contact_matches: "Multiple exact contact records",
  exact_organization_domain: "Exact organization domain",
  approved_business_label: "Business label/folder",
  existing_thread_association: "Previously approved thread",
  exact_profile_name_text: "Exact profile name in subject/snippet",
  ambiguous_organization_domain: "Multiple organization domain matches",
};

function ValidationRow({ row }: { row: GoogleRecentValidationRow }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-950/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-slate-900 dark:text-slate-100">
            {row.subject || "(No subject)"}
          </p>
          <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
            {row.from || "Unknown sender"}
          </p>
        </div>
        {row.hasAttachments ? (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Attachment
          </span>
        ) : null}
      </div>
      {row.labels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {row.labels.map((label) => (
            <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400" key={label.id}>
              {label.name}
            </span>
          ))}
        </div>
      ) : null}
      {row.evidenceCodes.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {row.evidenceCodes.map((code) => (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" key={code}>
              {evidenceLabels[code] ?? code}
            </span>
          ))}
        </div>
      ) : null}
      {row.matchedContact ? <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Matched contact: {row.matchedContact.name}</p> : null}
      {row.resolvedOrganization ? (
        <p className="mt-1 text-sm font-semibold text-emerald-800 dark:text-emerald-300">Profile: {row.resolvedOrganization.name}</p>
      ) : row.organizationCandidates.length > 0 ? (
        <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-300">Possible profiles: {row.organizationCandidates.map((candidate) => candidate.name).join(", ")}</p>
      ) : row.candidates.length > 0 ? (
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Possible match: {row.candidates.map((candidate) => candidate.name).join(", ")}</p>
      ) : null}
    </article>
  );
}

function ResultSection({ title, rows }: { title: string; rows: GoogleRecentValidationRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="grid gap-2">
      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">{title}</h4>
      {rows.map((row) => <ValidationRow key={row.id} row={row} />)}
    </section>
  );
}

function ApprovalControls({
  status,
  unresolvedCount,
  onStatus,
}: {
  status: GoogleValidationStatus;
  unresolvedCount: number;
  onStatus(status: GoogleValidationStatus): void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError(null);
    try {
      const result = await decideGoogleWorkspaceValidationSample(decision);
      onStatus(result.validationStatus);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the sample decision.");
    } finally {
      setBusy(null);
    }
  }

  if (status === "approved") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        <p className="font-bold">Sample approved</p>
        <p className="mt-1 text-xs">The resolved sample conversations can now appear on their profiles. The historical import is still off.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{status === "rejected" ? "Sample marked for more review" : "Ready for your decision"}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {unresolvedCount > 0
          ? `Approving will attach only the resolved matches. The ${unresolvedCount} item${unresolvedCount === 1 ? "" : "s"} in Needs Review will stay unlinked.`
          : "Approving makes these resolved sample conversations visible on their profiles."} The full historical import does not start.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="button-primary px-4 py-2" disabled={busy !== null} onClick={() => void decide("approve")} type="button">
          {busy === "approve" ? "Approving…" : unresolvedCount > 0 ? "Approve resolved matches" : "Approve sample"}
        </button>
        <button className="button-secondary px-4 py-2" disabled={busy !== null} onClick={() => void decide("reject")} type="button">
          {busy === "reject" ? "Saving…" : "Keep reviewing"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs font-medium text-rose-700 dark:text-rose-300">{error}</p> : null}
    </div>
  );
}

export function GoogleRecentValidation({ result }: { result: GoogleRecentValidationResult }) {
  const [showIgnored, setShowIgnored] = useState(false);
  const [validationStatus, setValidationStatus] = useState<GoogleValidationStatus>(result.validationStatus);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-200">{result.counts.discovered} checked</div>
        <div className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{result.counts.matched} matched</div>
        <div className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{result.counts.needsReview} needs review</div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">{result.counts.ignored} ignored</div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">AI is off. This is only a metadata/relevance check of the newest {result.checkedLimit} messages and does not start the historical import.</p>
      <ResultSection title="Matched to profiles" rows={result.matched} />
      {result.counts.needsReview > 0 ? <GoogleValidationReview /> : null}
      {result.ignored.length > 0 ? (
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{result.ignored.length} ignored in this sample</p>
            <button aria-expanded={showIgnored} className="text-xs font-semibold text-orange-700 hover:underline dark:text-orange-300" onClick={() => setShowIgnored((current) => !current)} type="button">
              {showIgnored ? "Hide ignored email" : "Review ignored email"}
            </button>
          </div>
          {showIgnored ? <div className="mt-3 grid max-h-96 gap-2 overflow-y-auto border-t border-slate-200 pt-3 dark:border-slate-700">{result.ignored.map((row) => <ValidationRow key={row.id} row={row} />)}</div> : null}
        </section>
      ) : null}
      <ApprovalControls status={validationStatus} unresolvedCount={result.counts.needsReview} onStatus={setValidationStatus} />
    </div>
  );
}
