import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/auth-token";

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

export default function ManagerIssuesAdminPage() {
  const [issues, setIssues] = useState<ScheduleIssue[]>([]);
  const [safetyIssues, setSafetyIssues] = useState<SafetyIssue[]>([]);
  const [checklists, setChecklists] = useState<ChecklistSummary[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setError("");
    try {
      const [schedule, safety, checklistData] = await Promise.all([
        apiGet<{ issues: ScheduleIssue[] }>("/manager-admin/issues?status=open"),
        apiGet<{ issues: SafetyIssue[] }>("/manager-admin/resource-condition-issues?state=open"),
        apiGet<{ checklists: ChecklistSummary[] }>("/manager-admin/events/checklists"),
      ]);
      setIssues(schedule.issues ?? []);
      setSafetyIssues(safety.issues ?? []);
      setChecklists(checklistData.checklists ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load manager issues.");
    }
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
          </article>
        )) : <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-600">No event safety checklists yet.</p>}
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
