import { useState } from "react";

import { GoogleMatchedEmailActions } from "@/components/google-workspace/google-matched-email-actions";
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
  existing_thread_association: "Confirmed Gmail thread",
  learned_external_email: "Confirmed external email",
  learned_external_email_ambiguous: "External email linked to multiple profiles",
  exact_profile_name_subject: "Profile name in email subject",
  ambiguous_profile_name_subject: "Multiple profile names fit subject",
  exact_profile_name_body: "Profile name in email content",
  ambiguous_profile_name_body: "Multiple profile names fit email content",
  weighted_profile_text_match: "Flexible event/profile match",
  weighted_profile_text_ambiguous: "Multiple flexible profile matches",
  weighted_profile_body_match: "Flexible match from email content",
  weighted_profile_body_ambiguous: "Multiple content matches",
  ai_profile_match: "AI profile match",
  ai_ignore: "AI marked irrelevant",
  ai_needs_review: "AI needs review",
  manual_profile_assignment: "Manually corrected profile",
  manual_ignore: "Manually ignored",
  exact_profile_name_text: "Exact profile name in subject/snippet",
  ambiguous_organization_domain: "Multiple organization domain matches",
};

type AiTriage = {
  outcome: "match" | "ignore" | "review";
  profileId: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  providerName: string;
};

type AiValidationRow = GoogleRecentValidationRow & {
  aiTriage?: AiTriage;
};

type AiValidationResult = Omit<
  GoogleRecentValidationResult,
  "aiEnabled" | "matched" | "needsReview" | "ignored"
> & {
  aiEnabled: boolean;
  aiStatus?: "enabled" | "disabled" | "unavailable";
  aiProvider?: string | null;
  aiCounts?: {
    attempted: number;
    matched: number;
    ignored: number;
    review: number;
  };
  matched: AiValidationRow[];
  needsReview: AiValidationRow[];
  ignored: AiValidationRow[];
};

function ValidationRow({
  row,
  editable = false,
  onAssigned,
  onIgnored,
}: {
  row: AiValidationRow;
  editable?: boolean;
  onAssigned?(profile: { id: string; name: string }): void;
  onIgnored?(): void;
}) {
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
      {row.aiTriage ? (
        <div className="mt-2 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-2 text-xs text-violet-900 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200">
          <span className="font-semibold">AI {row.aiTriage.outcome} · {row.aiTriage.confidence} confidence:</span>{" "}
          {row.aiTriage.reason}
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
      {editable && onAssigned && onIgnored ? (
        <GoogleMatchedEmailActions row={row} onAssigned={onAssigned} onIgnored={onIgnored} />
      ) : null}
    </article>
  );
}

function ResultSection({
  title,
  rows,
  editable = false,
  onAssigned,
  onIgnored,
}: {
  title: string;
  rows: AiValidationRow[];
  editable?: boolean;
  onAssigned?(row: AiValidationRow, profile: { id: string; name: string }): void;
  onIgnored?(row: AiValidationRow): void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="grid gap-2">
      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">{title}</h4>
      {rows.map((row) => (
        <ValidationRow
          editable={editable}
          key={row.id}
          onAssigned={onAssigned ? (profile) => onAssigned(row, profile) : undefined}
          onIgnored={onIgnored ? () => onIgnored(row) : undefined}
          row={row}
        />
      ))}
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
  const enhanced = result as unknown as AiValidationResult;
  const [showIgnored, setShowIgnored] = useState(false);
  const [validationStatus, setValidationStatus] = useState<GoogleValidationStatus>(enhanced.validationStatus);
  const [unresolvedCount, setUnresolvedCount] = useState(enhanced.counts.needsReview);
  const [matchedRows, setMatchedRows] = useState<AiValidationRow[]>(enhanced.matched);
  const [ignoredRows, setIgnoredRows] = useState<AiValidationRow[]>(enhanced.ignored);

  function assignMatched(row: AiValidationRow, profile: { id: string; name: string }) {
    setMatchedRows((current) => current.map((item) => item.id === row.id
      ? {
          ...item,
          resolvedOrganization: profile,
          evidenceCodes: [...new Set([...item.evidenceCodes, "manual_profile_assignment"])],
        }
      : item));
  }

  function ignoreMatched(row: AiValidationRow) {
    setMatchedRows((current) => current.filter((item) => item.id !== row.id));
    setIgnoredRows((current) => [
      {
        ...row,
        resolvedOrganization: null,
        evidenceCodes: [...new Set([...row.evidenceCodes, "manual_ignore"])],
      },
      ...current.filter((item) => item.id !== row.id),
    ]);
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-200">{enhanced.counts.discovered} checked</div>
        <div className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{matchedRows.length} matched</div>
        <div className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{unresolvedCount} needs review</div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">{ignoredRows.length} ignored</div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
        {enhanced.aiEnabled ? (
          <>
            <p className="font-semibold text-violet-800 dark:text-violet-300">AI triage is on{enhanced.aiProvider ? ` · ${enhanced.aiProvider}` : ""}</p>
            <p className="mt-1">Deterministic matching runs first. Uncertain messages may use readable Gmail thread text temporarily, then AI can match a supplied profile, ignore unrelated mail, or leave it for review. Ignored body text is not returned or stored.</p>
            {enhanced.aiCounts ? <p className="mt-1">AI checked {enhanced.aiCounts.attempted}: {enhanced.aiCounts.matched} matched · {enhanced.aiCounts.ignored} ignored · {enhanced.aiCounts.review} left for review.</p> : null}
          </>
        ) : enhanced.aiStatus === "unavailable" ? (
          <p className="font-semibold text-amber-800 dark:text-amber-300">AI triage is enabled but the AI provider is unavailable. Deterministic matching is still running.</p>
        ) : (
          <p>AI triage is off. The newest {enhanced.checkedLimit} messages use deterministic headers and temporary readable Gmail text only.</p>
        )}
        <p className="mt-1">The full historical import does not start from this check.</p>
      </div>
      <ResultSection editable onAssigned={assignMatched} onIgnored={ignoreMatched} title="Matched to profiles" rows={matchedRows} />
      {enhanced.counts.needsReview > 0 ? (
        <GoogleValidationReview onPendingCountChange={setUnresolvedCount} />
      ) : null}
      {ignoredRows.length > 0 ? (
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{ignoredRows.length} ignored in this sample</p>
            <button aria-expanded={showIgnored} className="text-xs font-semibold text-orange-700 hover:underline dark:text-orange-300" onClick={() => setShowIgnored((current) => !current)} type="button">
              {showIgnored ? "Hide ignored email" : "Review ignored email"}
            </button>
          </div>
          {showIgnored ? <div className="mt-3 grid max-h-96 gap-2 overflow-y-auto border-t border-slate-200 pt-3 dark:border-slate-700">{ignoredRows.map((row) => <ValidationRow key={row.id} row={row} />)}</div> : null}
        </section>
      ) : null}
      <ApprovalControls status={validationStatus} unresolvedCount={unresolvedCount} onStatus={setValidationStatus} />
    </div>
  );
}
