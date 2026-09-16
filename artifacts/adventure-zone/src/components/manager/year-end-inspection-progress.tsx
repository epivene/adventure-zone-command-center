import type { InspectionProgressDto } from "@/lib/year-end-inspections-api";

export function YearEndInspectionProgress({ progress }: { progress: InspectionProgressDto }) {
  return <section className="sticky top-0 z-10 rounded-xl border border-orange-200 bg-orange-50 p-4 shadow-sm" aria-label="Inspection progress">
    <div className="flex items-center justify-between gap-3">
      <p className="font-bold">{progress.inspected + progress.notPresent} of {progress.total} inspected</p>
      <p className="text-sm font-semibold text-orange-800">{progress.percentComplete}%</p>
    </div>
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-orange-100">
      <div className="h-full bg-orange-600" style={{ width: `${progress.percentComplete}%` }} />
    </div>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
      <span>{progress.notStarted} not started</span>
      <span>{progress.needsAttention} need attention</span>
      <span>{progress.notPresent} not present</span>
    </div>
  </section>;
}
