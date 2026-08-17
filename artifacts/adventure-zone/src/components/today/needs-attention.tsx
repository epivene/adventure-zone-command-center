import { Link } from "wouter";

export function NeedsAttention({
  followUpCount,
  newLeadCount,
  contractCount,
  visibleRouteWarningCount,
  newLeadHref,
}: {
  followUpCount: number;
  newLeadCount: number;
  contractCount: number;
  visibleRouteWarningCount: number;
  newLeadHref?: string;
}) {
  const items = [
    followUpCount > 0 ? { label: "Follow-ups due", count: followUpCount, href: "/today#follow-ups" } : null,
    newLeadCount > 0 ? { label: "New leads", count: newLeadCount, href: newLeadHref ?? "/profiles" } : null,
    contractCount > 0 ? { label: "Contracts needing attention", count: contractCount, href: "/bookings" } : null,
    visibleRouteWarningCount > 0 ? { label: "Route issues", count: visibleRouteWarningCount, href: "/manager-issues" } : null,
  ].filter((item): item is { label: string; count: number; href: string } => Boolean(item));

  if (!items.length) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="needs-attention-title">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold" id="needs-attention-title">Needs attention</h2>
          <p className="mt-1 text-sm text-slate-600">Just the things that need a decision or follow-up.</p>
        </div>
        <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-800">
          {items.reduce((sum, item) => sum + item.count, 0)}
        </span>
      </div>
      <div className="mt-3 divide-y divide-slate-100">
        {items.map((item) => (
          <Link
            className="flex items-center justify-between gap-3 py-3 text-sm font-semibold text-slate-800 hover:text-orange-700"
            href={item.href}
            key={item.label}
          >
            <span>{item.label}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{item.count}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
