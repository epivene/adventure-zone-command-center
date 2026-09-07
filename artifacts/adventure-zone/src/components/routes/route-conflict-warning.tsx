import { Link } from "wouter";
import type { RouteConflict } from "@/features/routes/route-conflicts";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function overlapLabel(conflict: RouteConflict) {
  return conflict.overlapFrom === conflict.overlapTo
    ? formatDate(conflict.overlapFrom)
    : `${formatDate(conflict.overlapFrom)}–${formatDate(conflict.overlapTo)}`;
}

export function RouteConflictWarning({ conflicts, readOnly = false }: { conflicts: RouteConflict[]; readOnly?: boolean }) {
  if (!conflicts.length) return null;
  return (
    <details
      className="group rounded-xl border border-rose-300 bg-rose-50 shadow-sm"
      aria-label="Route schedule conflicts"
      role="region"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-rose-700">Schedule conflict</p>
          <h2 className="mt-1 text-lg font-bold text-rose-950">{conflicts.length} same-leg overlap{conflicts.length === 1 ? "" : "s"}</h2>
        </div>
        <span className="shrink-0 text-sm font-semibold text-rose-700">
          Details <span aria-hidden="true" className="inline-block transition group-open:rotate-180">⌄</span>
        </span>
      </summary>
      <div className="border-t border-rose-200 p-4">
        <p className="text-sm text-rose-800">Each event reserves the leg for setup the day before and teardown the day after. Potential leads are included so conflicts are caught before booking.</p>
        <div className="mt-3 grid gap-2">
          {conflicts.map((conflict) => (
            <div className="rounded-lg border border-rose-200 bg-white/80 p-3 text-sm" key={`${conflict.first.id}:${conflict.second.id}`}>
              <p className="font-bold text-rose-950">{conflict.legName} · operational overlap {overlapLabel(conflict)}</p>
              <p className="mt-1 text-slate-700">
                {readOnly ? <span className="font-semibold">{conflict.first.name}</span> : <Link className="font-semibold text-orange-700 hover:underline" href={`/bookings/${conflict.first.id}`}>{conflict.first.name}</Link>}
                <span className="mx-1.5 text-slate-400">↔</span>
                {readOnly ? <span className="font-semibold">{conflict.second.name}</span> : <Link className="font-semibold text-orange-700 hover:underline" href={`/bookings/${conflict.second.id}`}>{conflict.second.name}</Link>}
              </p>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
