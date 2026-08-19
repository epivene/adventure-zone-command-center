import { Link } from "wouter";
import { ExternalLink } from "lucide-react";

type ResearchSourceAction = {
  id: string;
  title: string;
  url: string | null;
  publisher: string | null;
  excerpt: string;
};

function saveSourceHref(source: ResearchSourceAction) {
  const query = new URLSearchParams({ url: source.url ?? "", title: source.title });
  return `/research-sources?${query.toString()}`;
}

export function ProfileResearchNextActions({
  sources,
  onScout,
}: {
  sources: ResearchSourceAction[];
  onScout(source: ResearchSourceAction): void;
}) {
  const usable = sources.filter((source) => source.url).slice(0, 3);
  if (!usable.length) return null;

  return (
    <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3" aria-label="Research next actions">
      <p className="font-semibold text-slate-950">Next actions</p>
      <p className="mt-1 text-sm text-slate-600">Use the sources this research found instead of stopping at the summary.</p>
      <div className="mt-3 grid gap-2">
        {usable.map((source) => (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2.5" key={source.id}>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{source.title}</p><p className="truncate text-xs text-slate-500">{source.publisher ?? source.url}</p></div>
            <div className="flex flex-wrap gap-2">
              <a className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700" href={source.url!} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-3.5 w-3.5" />Open source</a>
              <button className="rounded-lg border border-orange-200 px-2.5 py-1.5 text-xs font-semibold text-orange-700" type="button" onClick={() => onScout(source)}>Scout source</button>
              <Link className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700" href={saveSourceHref(source)}>Save source</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
