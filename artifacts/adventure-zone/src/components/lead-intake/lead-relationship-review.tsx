import { useState } from "react";

import type {
  LeadImportReviewRow,
  LeadRelationshipClassification,
  LeadRelationshipOutcome,
} from "@/features/lead-intake/lead-intake-client";

type RelationshipClient = {
  classifyRelationship(rowId: string, expectedVersion: number): Promise<LeadRelationshipClassification>;
};

const emailStyleByOutcome: Partial<Record<LeadRelationshipOutcome, string>> = {
  new_introduction: "New introduction email",
  prior_outreach_no_response: "Prior outreach follow-up email",
  returning_contact: "Returning contact email",
  reintroduction: "Reintroduction email",
};

function readableDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function explanation(row: LeadImportReviewRow) {
  const responseDate = readableDate(row.latestVerifiedResponseAt);
  const outboundDate = readableDate(row.latestOutboundAt);
  switch (row.relationshipOutcome) {
    case "returning_contact":
      return `Returning contact: verified reply${responseDate ? ` on ${responseDate}` : ""}.`;
    case "reintroduction":
      return `Reintroduction: the latest verified reply${responseDate ? ` was ${responseDate}` : ""} and is older than three years.`;
    case "prior_outreach_no_response":
      return `Prior outreach with no verified reply${outboundDate ? `; latest outgoing contact was ${outboundDate}` : ""}.`;
    case "new_introduction":
      return "New introduction: no verified prior contact was found.";
    case "needs_review":
      return "Previous contact needs review because the available history is incomplete, ambiguous, or conflicting.";
    default:
      return "Previous contact has not been checked yet.";
  }
}

function sourceLabel(evidenceId: string) {
  const source = evidenceId.split(":", 1)[0]?.toLowerCase();
  if (source === "gmail") return "Gmail";
  if (source === "act") return "ACT";
  if (source === "crm") return "CRM";
  return "Source";
}

export function LeadRelationshipReview({
  row,
  client,
  onClassified,
}: {
  row: LeadImportReviewRow;
  client: RelationshipClient;
  onClassified: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function classify() {
    if (busy || row.state !== "verified") return;
    setBusy(true);
    setError("");
    try {
      await client.classifyRelationship(row.id, row.reviewVersion);
      await onClassified();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check previous contact.");
    } finally {
      setBusy(false);
    }
  }

  const style = row.relationshipOutcome ? emailStyleByOutcome[row.relationshipOutcome] : null;
  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h3 className="text-lg font-bold">Previous contact</h3>
        <p className="text-sm text-slate-600">Only verified ACT or Gmail direction can establish that this recipient replied.</p>
      </div>

      <p className={row.relationshipReviewRequired ? "rounded-lg bg-amber-50 p-3 text-amber-900" : "rounded-lg bg-slate-50 p-3"}>
        {explanation(row)}
      </p>

      {!row.relationshipOutcome ? (
        <button
          className="button-secondary justify-self-start"
          disabled={busy || row.state !== "verified"}
          onClick={() => void classify()}
          type="button"
        >
          {busy ? "Checking…" : "Check previous contact"}
        </button>
      ) : null}

      {(row.relationshipEvidenceIds?.length ?? 0) > 0 ? (
        <div className="grid gap-2">
          <p className="text-sm font-semibold">Evidence used</p>
          {(row.relationshipEvidenceIds ?? []).map((evidenceId) => (
            <details className="rounded-lg border p-3 text-sm" key={evidenceId}>
              <summary className="cursor-pointer font-semibold">
                Supporting source <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-xs">{sourceLabel(evidenceId)}</span>
              </summary>
              <p className="mt-2 break-all font-mono text-xs text-slate-600">{evidenceId}</p>
            </details>
          ))}
        </div>
      ) : null}

      {style && !row.relationshipReviewRequired ? (
        <div className="grid gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Email style</p>
          <p className="font-semibold">{style}</p>
          {row.contactMode === "organization_inbox" ? (
            <div className="rounded-lg bg-white p-3"><p className="text-xs font-semibold uppercase text-slate-500">Greeting preview</p><p>Hi,</p></div>
          ) : null}
        </div>
      ) : row.relationshipOutcome === "needs_review" ? (
        <p className="font-semibold text-amber-900">Drafting blocked</p>
      ) : null}

      {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p> : null}
    </section>
  );
}
