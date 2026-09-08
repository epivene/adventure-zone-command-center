import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/auth-token";
import { LegEventRecordGroups } from "@/components/records/leg-event-record-groups";

type ScheduleIssue = {
  id: string;
  kind: string;
  notes: string | null;
};

type SafetyIssue = {
  id: string;
  resourceId: string | null;
  resourceName: string | null;
  resourceNameSnapshot: string | null;
  bookingId: string;
  bookingName: string;
  runId: string;
  phase: "pre_event" | "post_event";
  legId: string;
  legName: string;
  severity: "needs_work_safe" | "unsafe";
  state: "open" | "resolved";
  summary: string;
  note: string;
  itemLabel: string;
  followUpSyncState: string;
  createdAt: string;
};

type ChecklistSummary = {
  id: string;
  bookingId: string;
  bookingName: string;
  legId: string;
  legName: string;
  phase: "pre_event" | "post_event";
  state: "in_progress" | "completed" | "unable_to_complete";
  startedAt: string;
  completedAt: string | null;
  unableReason: string | null;
  unsafeCount: number;
  needsWorkCount: number;
  followUpAttentionCount: number;
  readyOverride: boolean;
  checkoutOverride: boolean;
};

type ChecklistRecord = ChecklistSummary & {
  items: Array<{ id: string; label: string; resourceName: string | null; result: string | null; note: string | null }>;
};

type ReviewDue = { bookingId: string; bookingName: string; legId: string | null; legName: string | null; endsAt: string | null };
type SavedReview = {
  id: string; bookingId: string; bookingName: string; legId: string | null; legName: string | null; rating: number; feedback: string | null;
  organizerSiteNotes: string | null; crewNotes: string | null; recommendReturn: "yes" | "no" | "unsure" | null;
  createdAt: string;
};

export default function ManagerIssuesAdminPage() {
  const [issues, setIssues] = useState<ScheduleIssue[]>([]);
  const [safetyIssues, setSafetyIssues] = useState<SafetyIssue[]>([]);
  const [checklists, setChecklists] = useState<ChecklistSummary[]>([]);
  const [reviewsDue, setReviewsDue] = useState<ReviewDue[]>([]);
  const [savedReviews, setSavedReviews] = useState<SavedReview[]>([]);
  const [openRecord, setOpenRecord] = useState<ChecklistRecord | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setError("");
    try {
      const [schedule, safety, checklistData, reviewData, savedReviewData] = await Promise.all([
        apiGet<{ issues: ScheduleIssue[] }>("/manager-admin/issues?status=open"),
        apiGet<{ issues: SafetyIssue[] }>("/manager-admin/resource-condition-issues?state=open"),
        apiGet<{ checklists: ChecklistSummary[] }>("/manager-admin/events/checklists"),
        apiGet<{ reviewsDue: ReviewDue[] }>("/manager-admin/reviews/due"),
        apiGet<{ reviews: SavedReview[] }>("/manager-admin/reviews"),
      ]);
      setIssues(schedule.issues ?? []);
      setSafetyIssues(safety.issues ?? []);
      setChecklists(checklistData.checklists ?? []);
      setReviewsDue(reviewData.reviewsDue ?? []);
      setSavedReviews(savedReviewData.reviews ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load manager issues.");
    }
  }

  async function toggleChecklist(run: ChecklistSummary) {
    if (openRecord?.id === run.id) { setOpenRecord(null); return; }
    setBusy(`open:${run.id}`);
    try {
      const data = await apiGet<{ record: ChecklistRecord }>(`/manager-admin/events/checklists/${run.id}`);
      setOpenRecord(data.record);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open checklist.");
    } finally { setBusy(null); }
  }

  async function removeChecklist(run: ChecklistSummary) {
    if (!window.confirm(`Remove the saved checklist for “${run.bookingName}”?`)) return;
    setBusy(`remove:${run.id}`);
    try {
      await apiDelete(`/manager-admin/events/checklists/${run.id}`);
      if (openRecord?.id === run.id) setOpenRecord(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove checklist.");
    } finally { setBusy(null); }
  }

  async function removeReviewDue(item: ReviewDue) {
    if (!window.confirm(`Remove “${item.bookingName}” from Review Due?`)) return;
    setBusy(`review:${item.bookingId}`);
    try {
      await apiDelete(`/manager-admin/reviews/due/${item.bookingId}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove review-due item.");
    } finally { setBusy(null); }
  }

  async function editSavedReview(review: SavedReview) {
    const ratingText = window.prompt("Rating from 0 to 5", String(review.rating));
    if (ratingText == null) return;
    const rating = Number(ratingText);
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
      setError("Rating must be a whole number from 0 to 5.");
      return;
    }
    const feedback = window.prompt("Feedback", review.feedback ?? "");
    if (feedback == null) return;
    const crewNotes = window.prompt("Crew notes", review.crewNotes ?? "");
    if (crewNotes == null) return;
    setBusy(`saved-review:${review.id}`);
    try {
      await apiPatch(`/manager-admin/reviews/${review.id}`, {
        rating,
        feedback: feedback.trim() || null,
        crewNotes: crewNotes.trim() || null,
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update review.");
    } finally { setBusy(null); }
  }

  async function deleteSavedReview(review: SavedReview) {
    if (!window.confirm(`Delete the saved review for “${review.bookingName}”?`)) return;
    setBusy(`saved-review:${review.id}`);
    try {
      await apiDelete(`/manager-admin/reviews/${review.id}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete review.");
    } finally { setBusy(null); }
  }

  useEffect(() => { void load(); }, []);

  async function resolveSchedule(id: string) {
    const resolutionNote = window.prompt("Resolution note");
    if (!resolutionNote) return;
    setBusy(`schedule:${id}`);
    try {
      await apiPost(`/manager-admin/issues/${id}/resolve`, { resolutionNote });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not resolve schedule issue.");
    } finally { setBusy(null); }
  }

  async function resolveCondition(issue: SafetyIssue) {
    const resolutionNote = window.prompt("Resolution note");
    if (!resolutionNote) return;
    setBusy(`condition:${issue.id}`);
    try {
      await apiPost(`/manager-admin/resource-condition-issues/${issue.id}/resolve`, { resolutionNote });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not resolve safety condition.");
    } finally { setBusy(null); }
  }

  async function override(issue: SafetyIssue) {
    const action = issue.phase === "pre_event" ? "allow_ready_to_operate" : "allow_checkout";
    const label = issue.phase === "pre_event" ? "Allow ready to operate" : "Allow checkout";
    const reason = window.prompt(`Override reason — ${label}`);
    if (!reason) return;
    setBusy(`override:${issue.runId}`);
    try {
      await apiPost(`/manager-admin/events/checklists/${issue.runId}/override`, { action, reason });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save checklist override.");
    } finally { setBusy(null); }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header>
        <h1 className="text-3xl font-bold">Manager &amp; safety issues</h1>
        <p className="mt-1 text-slate-600">Active schedule problems, event safety conditions, checklist status, and owner overrides across all legs.</p>
      </header>

      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}

      <section className="grid gap-3">
        <div>
          <h2 className="text-xl font-bold">Event safety issues</h2>
          <p className="text-sm text-slate-600">Resolving a condition closes the maintenance/safety issue. A lifecycle override is separate and never changes the manager’s original checklist answer.</p>
        </div>
        {safetyIssues.length ? safetyIssues.map((issue) => (
          <article className={`rounded-xl border p-4 ${issue.severity === "unsafe" ? "border-rose-300 bg-rose-50" : "border-amber-300 bg-amber-50"}`} key={issue.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600">{issue.severity === "unsafe" ? "Unsafe — cannot operate" : "Needs work but safe"}</p>
                <h3 className="mt-1 text-lg font-bold">{issue.resourceName ?? issue.resourceNameSnapshot ?? "Event site"}</h3>
                <p className="text-sm text-slate-700">{issue.bookingName} · {issue.legName} · {issue.phase === "pre_event" ? "Pre-event" : "Post-event"}</p>
              </div>
              {issue.followUpSyncState === "needs_attention" ? <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-bold text-rose-800">Sync needs attention</span> : null}
            </div>
            <p className="mt-3 font-semibold">{issue.itemLabel}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{issue.note}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="button-secondary" disabled={busy !== null} onClick={() => void resolveCondition(issue)} type="button">{busy === `condition:${issue.id}` ? "Resolving…" : "Resolve condition"}</button>
              <button className="button-secondary" disabled={busy !== null} onClick={() => void override(issue)} type="button">{busy === `override:${issue.runId}` ? "Saving override…" : issue.phase === "pre_event" ? "Allow ready to operate" : "Allow checkout"}</button>
            </div>
          </article>
        )) : <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-600">No open checklist safety issues.</p>}
      </section>

      <section className="grid gap-3">
        <div><h2 className="text-xl font-bold">Checklist history</h2><p className="text-sm text-slate-600">Recent pre-event and post-event runs, including exceptions and recorded owner overrides.</p></div>
        {checklists.length ? checklists.map((run) => (
          <article className="rounded-xl border bg-white p-4" key={run.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h3 className="font-bold">{run.bookingName}</h3><p className="text-sm text-slate-600">{run.legName} · {run.phase === "pre_event" ? "Pre-event" : "Post-event"}</p></div>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{run.state.replaceAll("_", " ")}</span>
            </div>
            <p className="mt-2 text-sm text-slate-700">Unsafe: {run.unsafeCount} · Needs work: {run.needsWorkCount} · Follow-up attention: {run.followUpAttentionCount}</p>
            {run.unableReason ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Unable to complete: {run.unableReason}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
              {run.readyOverride ? <span className="rounded-full bg-violet-100 px-2 py-1 text-violet-800">Ready-to-operate override</span> : null}
              {run.checkoutOverride ? <span className="rounded-full bg-violet-100 px-2 py-1 text-violet-800">Checkout override</span> : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="button-secondary" disabled={busy !== null} onClick={() => void toggleChecklist(run)} type="button">{openRecord?.id === run.id ? "Close record" : "Open record"}</button>
              <button className="button-secondary text-rose-700" disabled={busy !== null} onClick={() => void removeChecklist(run)} type="button">Remove</button>
            </div>
            {openRecord?.id === run.id ? <div className="mt-4 grid gap-2 border-t pt-4">
              {openRecord.items.map((item) => <div className="rounded-lg bg-slate-50 p-3 text-sm" key={item.id}>
                <div className="flex justify-between gap-2"><strong>{item.label}</strong><span className="capitalize text-slate-600">{item.result?.replaceAll("_", " ") ?? "Not answered"}</span></div>
                {item.resourceName ? <p className="text-xs text-slate-500">{item.resourceName}</p> : null}
                {item.note ? <p className="mt-2 whitespace-pre-wrap">{item.note}</p> : null}
              </div>)}
            </div> : null}
          </article>
        )) : <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-600">No event safety checklists yet.</p>}
      </section>

      <section className="grid gap-3">
        <div><h2 className="text-xl font-bold">Review Due</h2><p className="text-sm text-slate-600">Completed events still waiting for a crew review. Remove items that should no longer be requested.</p></div>
        {reviewsDue.length ? <LegEventRecordGroups records={reviewsDue} noun="review">{(item) => <article className="rounded-xl border bg-white p-4" key={item.bookingId}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="font-bold">{item.bookingName}</h3><p className="text-sm text-slate-600">{item.legName}{item.endsAt ? ` · ${new Date(item.endsAt).toLocaleDateString()}` : ""}</p></div>
            <button className="button-secondary text-rose-700" disabled={busy !== null} onClick={() => void removeReviewDue(item)} type="button">Remove from Review Due</button>
          </div>
        </article>}</LegEventRecordGroups> : <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-600">No reviews are due.</p>}
      </section>

      <section className="grid gap-3">
        <div><h2 className="text-xl font-bold">Saved event reviews</h2><p className="text-sm text-slate-600">Correct or delete reviews when operational records need to be updated.</p></div>
        {savedReviews.length ? <LegEventRecordGroups records={savedReviews} noun="review">{(review) => <article className="rounded-xl border bg-white p-4" key={review.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">{review.bookingName}</h3>
              <p className="text-sm text-slate-600">{review.legName} · {review.rating}/5 · {new Date(review.createdAt).toLocaleDateString()}</p>
              {review.feedback ? <p className="mt-2 whitespace-pre-wrap text-sm">{review.feedback}</p> : null}
              {review.crewNotes ? <p className="mt-2 text-sm"><strong>Crew:</strong> {review.crewNotes}</p> : null}
            </div>
            <div className="flex gap-2">
              <button className="button-secondary" disabled={busy !== null} onClick={() => void editSavedReview(review)} type="button">Edit review</button>
              <button className="button-secondary text-rose-700" disabled={busy !== null} onClick={() => void deleteSavedReview(review)} type="button">Delete review</button>
            </div>
          </div>
        </article>}</LegEventRecordGroups> : <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-600">No saved event reviews.</p>}
      </section>

      <section className="grid gap-3">
        <div><h2 className="text-xl font-bold">Manager schedule issues</h2><p className="text-sm text-slate-600">Existing route, schedule, and operations problems reported by managers.</p></div>
        {issues.length ? issues.map((issue) => (
          <article className="rounded-xl border bg-white p-4" key={issue.id}>
            <p className="font-bold">{issue.kind.replaceAll("_", " ")}</p>
            {issue.notes ? <p className="mt-1 text-sm">{issue.notes}</p> : null}
            <button className="button-secondary mt-3" disabled={busy !== null} onClick={() => void resolveSchedule(issue.id)} type="button">{busy === `schedule:${issue.id}` ? "Resolving…" : "Mark resolved"}</button>
          </article>
        )) : <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-600">No open manager schedule issues.</p>}
      </section>
    </div>
  );
}
