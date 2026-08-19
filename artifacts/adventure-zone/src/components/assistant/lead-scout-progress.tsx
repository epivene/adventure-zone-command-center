import type { LeadScoutRunView } from "@/features/assistant/assistant-types";

export function LeadScoutProgress({
  run,
  onStop,
  onContinue,
}: {
  run: LeadScoutRunView;
  onStop(): void;
  onContinue(): void;
}) {
  const label = run.status === "stopping"
    ? "Stopping…"
    : run.status === "stopped"
      ? "Search stopped — partial results"
      : run.status === "complete"
        ? "Search complete"
        : run.status === "failed"
          ? "Search stopped with an error"
          : run.progress.label || "Researching public event sources";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-950">{label}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {run.progress.sourcesChecked} sources checked · {run.progress.candidatesFound} candidates found · {run.progress.candidatesCompared} compared with Command Center
          </p>
        </div>
        {run.status === "running" ? (
          <button className="button-secondary" onClick={onStop} type="button">Stop search</button>
        ) : run.status === "stopped" ? (
          <button className="button-primary" onClick={onContinue} type="button">Continue search</button>
        ) : null}
      </div>
      {run.status === "failed" && run.failureMessage ? (
        <p className="mt-2 text-sm text-rose-700">{run.failureMessage}</p>
      ) : null}
    </section>
  );
}
