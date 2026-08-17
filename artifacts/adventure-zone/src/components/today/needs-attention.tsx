import { SummaryCards } from "./summary-cards";

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
  const total = followUpCount + newLeadCount + contractCount + visibleRouteWarningCount;
  if (!total) return null;

  return (
    <section className="grid gap-3" aria-labelledby="needs-attention-title">
      <div>
        <h2 className="text-xl font-bold" id="needs-attention-title">Needs Attention</h2>
        <p className="mt-1 text-sm text-slate-600">Only things that currently need action show up here.</p>
      </div>
      <SummaryCards
        contractCount={contractCount}
        followUpCount={followUpCount}
        newLeadCount={newLeadCount}
        newLeadHref={newLeadHref}
        visibleRouteWarningCount={visibleRouteWarningCount}
      />
    </section>
  );
}
