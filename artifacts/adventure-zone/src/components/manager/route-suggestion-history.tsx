export type ManagerRouteSuggestionView = {
  id: string;
  targetType: "trip" | "trip_stop" | "booking" | "handoff";
  targetId: string;
  kind: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  adminResponse: string | null;
  stale: boolean;
  createdAt: string | Date;
};

export function RouteSuggestionHistory({ suggestions }: { suggestions: ManagerRouteSuggestionView[] }) {
  if (!suggestions.length) return <p className="text-sm text-slate-500">No route changes suggested yet.</p>;
  return (
    <div className="grid gap-2">
      {suggestions.map((suggestion) => (
        <article className="rounded-lg border border-slate-200 bg-white p-3" key={suggestion.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{suggestion.kind.replaceAll("_", " ")}</p>
            <span className={`rounded-full px-2 py-1 text-xs font-bold ${suggestion.status === "pending" ? "bg-amber-100 text-amber-800" : suggestion.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
              {suggestion.status === "pending" ? "Awaiting approval" : suggestion.status === "approved" ? "Approved" : "Rejected"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-700">{suggestion.reason}</p>
          {suggestion.stale ? <p className="mt-2 text-sm font-semibold text-amber-700">Official route changed; admin needs to review this again.</p> : null}
          {suggestion.adminResponse ? <p className="mt-2 text-sm text-slate-600">Admin: {suggestion.adminResponse}</p> : null}
        </article>
      ))}
    </div>
  );
}
