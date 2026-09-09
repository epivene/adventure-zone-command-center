import { useState } from "react";
import { decideEmailTemplate } from "@/features/boss-work-requests/boss-work-request-api";
import type { BossWorkRequestDetail } from "@/features/boss-work-requests/boss-work-request-types";

export function EmailTemplateReview({ detail, reload }: { detail: BossWorkRequestDetail; reload: () => Promise<void> }) {
  const review = detail.templateReview;
  const [note, setNote] = useState(review?.note ?? "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  if (!review) return <p>Template preview is unavailable.</p>;

  async function decide(decision: "approved" | "changes_requested") {
    if (decision === "changes_requested" && !note.trim()) { setError("Tell Desiree what you want changed."); return; }
    setWorking(true); setError("");
    try { await decideEmailTemplate(detail.request.id, decision, note.trim() || null); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save your answer."); }
    finally { setWorking(false); }
  }

  const finished = review.decision !== "pending";
  return (
    <div className="grid gap-5">
      <section className="rounded-xl border bg-card p-4 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-wider text-primary">Email preview</p>
        <h2 className="mt-2 text-lg font-bold">{review.subjectSnapshot || "(No subject)"}</h2>
        <div className="mt-4 overflow-hidden rounded-xl border bg-white">
          {review.bodyFormatSnapshot === "html"
            ? <iframe title="Email template preview" sandbox="" srcDoc={review.bodySnapshot} className="min-h-[34rem] w-full" />
            : <pre className="min-h-64 whitespace-pre-wrap p-5 font-sans text-sm text-slate-900">{review.bodySnapshot}</pre>}
        </div>
      </section>
      <section className="rounded-xl border bg-card p-4 sm:p-6">
        <label className="grid gap-2 font-semibold">Notes for Desiree
          <textarea disabled={finished} rows={4} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="What should be changed, or any approval notes…" className="rounded-lg border bg-background p-3 font-normal" />
        </label>
        {error && <p className="mt-2 text-sm font-semibold text-destructive">{error}</p>}
        {finished ? <p className="mt-4 rounded-lg bg-muted p-3 font-semibold">Answer saved: {review.decision.replaceAll("_", " ")}</p> : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button disabled={working} onClick={() => void decide("changes_requested")} className="min-h-12 rounded-xl border px-4 font-bold">Request Changes</button>
            <button disabled={working} onClick={() => void decide("approved")} className="min-h-12 rounded-xl bg-primary px-4 font-bold text-primary-foreground">Approve Template</button>
          </div>
        )}
      </section>
    </div>
  );
}
