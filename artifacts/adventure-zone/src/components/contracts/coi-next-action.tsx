import { useState } from "react";

import { contractClient } from "@/features/contracts/contract-client";

export type CoiDraftView = {
  state: "details_needed" | "prepared" | "created" | "retryable_error" | "manual_review";
  recipientEmail?: string;
  subject?: string;
  gmailMessageId?: string | null;
};

export function CoiNextAction({ contractVersionId, coiDraft, onRefresh }: {
  contractVersionId: string;
  coiDraft: CoiDraftView | null | undefined;
  onRefresh(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!coiDraft) return null;

  async function retry() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await contractClient.retryCoiDraft(contractVersionId);
      onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not retry the COI draft.");
      setBusy(false);
    }
  }

  if (coiDraft.state === "created") return (
    <section className="grid gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <h2 className="text-lg font-bold">COI request draft ready</h2>
      <p className="text-sm">To: <span>{coiDraft.recipientEmail}</span></p>
      <p className="text-sm">Subject: <span>{coiDraft.subject}</span></p>
      {coiDraft.gmailMessageId ? <a className="button-primary min-h-11 text-center" href={`https://mail.google.com/mail/u/0/#drafts/${coiDraft.gmailMessageId}`} rel="noreferrer" target="_blank">Review COI draft</a> : null}
      <p className="text-xs text-slate-600">This is an editable, unsent Gmail draft. Review it in Gmail before sending.</p>
    </section>
  );
  if (coiDraft.state === "details_needed") return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <h2 className="font-bold">COI details needed</h2>
      <p className="mt-1 text-sm">Create a replacement contract and add the certificate holder, mailing address, and exact additional-insured wording.</p>
    </section>
  );
  if (coiDraft.state === "manual_review" || coiDraft.state === "prepared") return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <h2 className="font-bold">Check Gmail before retrying</h2>
      <p className="mt-1 text-sm">The prior draft result is uncertain. Look in Gmail Drafts for the COI subject so another draft is not created.</p>
    </section>
  );
  return (
    <section className="grid gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4">
      <h2 className="font-bold">COI draft needs retry</h2>
      <p className="text-sm">The signed contract is safely completed. Retry only the editable Gmail draft.</p>
      <button className="button-secondary min-h-11" disabled={busy} onClick={() => void retry()} type="button">{busy ? "Retrying…" : "Retry COI draft"}</button>
      {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
    </section>
  );
}
