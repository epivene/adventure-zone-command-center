import { Link } from "wouter";

import { ResearchSourcesAttention } from "./research-sources-attention";

export function NeedsAttention({
  visibleRouteWarningCount,
}: {
  visibleRouteWarningCount: number;
}) {
  const items = [
    visibleRouteWarningCount > 0 ? { label: "Route issues", count: visibleRouteWarningCount, href: "/manager-issues" } : null,
  ].filter((item): item is { label: string; count: number; href: string } => Boolean(item));

  return (
    <div className="grid gap-3">
      {items.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Needs attention items">
          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <Link
                className="flex items-center justify-between gap-3 py-3 text-sm font-semibold text-slate-800 first:pt-0 last:pb-0 hover:text-orange-700"
                href={item.href}
                key={item.label}
              >
                <span>{item.label}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{item.count}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <ResearchSourcesAttention />
    </div>
  );
}
