export type LegAssignmentView = {
  assignedLegId: string | null;
  suggestedLegId: string | null;
  source: "prior_year" | "route_score" | "manual" | "needs_review";
  explanation: string;
  warning: "long_travel" | "major_travel_concern" | null;
  confidence: "high" | "medium" | "low";
};

function warningText(warning: LegAssignmentView["warning"]) {
  if (warning === "major_travel_concern") return "Major travel concern";
  if (warning === "long_travel") return "Long travel";
  return null;
}

export function LegAssignmentPanel({
  assignment,
  travelLegs,
}: {
  assignment: LegAssignmentView | null | undefined;
  travelLegs: Array<{ id: string; name: string }>;
}) {
  if (!assignment) return null;
  const legName = (id: string | null) =>
    id ? travelLegs.find((leg) => leg.id === id)?.name ?? "Unknown leg" : null;
  const assigned = legName(assignment.assignedLegId);
  const suggested = legName(assignment.suggestedLegId);
  const warning = warningText(assignment.warning);

  return (
    <section className="mb-5 grid gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Leg assignment recommendation">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-bold text-slate-950">
          {assigned
            ? `Assigned: ${assigned}`
            : suggested
              ? `Suggested: ${suggested}`
              : "Needs leg assignment"}
        </p>
        {assignment.source === "prior_year" ? (
          <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">Last year's leg</span>
        ) : null}
        {warning ? (
          <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">{warning}</span>
        ) : null}
      </div>
      <p className="text-sm text-slate-600">{assignment.explanation}</p>
      {assignment.source !== "manual" ? (
        <p className="text-xs text-slate-500">You can change the assigned leg below at any time. A manual choice will not be overwritten automatically.</p>
      ) : null}
    </section>
  );
}
