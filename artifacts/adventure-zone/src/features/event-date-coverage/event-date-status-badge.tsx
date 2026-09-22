import type { EventDateCoverageStatus } from "./event-date-coverage-api";

const labels: Record<EventDateCoverageStatus, string> = {
  booked: "Booked", confirmed: "Confirmed", expected: "Expected",
  needs_review: "Needs review", missing: "Date not found", stale: "Stale",
};
const styles: Record<EventDateCoverageStatus, string> = {
  booked: "bg-emerald-100 text-emerald-800", confirmed: "bg-blue-100 text-blue-800",
  expected: "bg-violet-100 text-violet-800", needs_review: "bg-amber-100 text-amber-900",
  missing: "bg-slate-100 text-slate-700", stale: "bg-rose-100 text-rose-800",
};
export function EventDateStatusBadge({ status }: { status: EventDateCoverageStatus }) {
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${styles[status]}`}>{labels[status]}</span>;
}
