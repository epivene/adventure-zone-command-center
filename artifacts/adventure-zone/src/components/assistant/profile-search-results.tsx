import type { AssistantProfileSearchResult } from "@/features/assistant/assistant-types";

export function ProfileSearchResults({
  results,
  onUseContext,
  onOpenProfile,
}: {
  results: AssistantProfileSearchResult[];
  onUseContext(result: AssistantProfileSearchResult): void;
  onOpenProfile(result: AssistantProfileSearchResult): void;
}) {
  if (!results.length) return null;
  return (
    <div className="grid gap-2">
      {results.map((result) => {
        const location = [result.city, result.region].filter(Boolean).join(", ");
        return (
          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={`${result.kind}:${result.id}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-bold text-slate-950">{result.label}</h3>
                {result.secondaryLabel ? <p className="truncate text-sm text-slate-600">{result.secondaryLabel}</p> : null}
                <p className="mt-1 text-xs text-slate-500">
                  {[location, result.status, result.bookingCount != null ? `${result.bookingCount} bookings` : null].filter(Boolean).join(" · ") || "Profile"}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                {result.kind.replace("_", " ")}
              </span>
            </div>
            {result.matchedOn.length ? (
              <p className="mt-2 text-xs text-slate-500">Matched on {result.matchedOn.join(", ")}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="button-primary" onClick={() => onUseContext(result)} type="button">Use as context</button>
              <button className="button-secondary" onClick={() => onOpenProfile(result)} type="button">Open profile</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
