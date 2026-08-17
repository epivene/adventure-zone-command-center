import { Link } from "wouter";

type SummaryCardsProps = {
  followUpCount: number;
  newLeadCount: number;
  contractCount: number;
  visibleRouteWarningCount: number;
  newLeadHref?: string;
};

const cards = [
  { key: "followUpCount", label: "Follow-ups due", tone: "text-rose-700" },
  { key: "newLeadCount", label: "New leads", tone: "text-orange-700" },
  { key: "contractCount", label: "Contracts", tone: "text-indigo-700" },
  {
    key: "visibleRouteWarningCount",
    label: "Route issues",
    tone: "text-amber-700",
  },
] as const;

export function SummaryCards(props: SummaryCardsProps) {
  const visibleCards = cards.filter((card) => Number(props[card.key] ?? 0) > 0);
  if (!visibleCards.length) return null;

  return (
    <section aria-label="Needs attention summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {visibleCards.map((card) => {
        const content = <>
          <p className="text-sm font-semibold text-slate-600">{card.label}</p>
          <p className={`mt-1 text-2xl font-bold tracking-tight ${card.tone}`}>
            {props[card.key]}
          </p>
        </>;
        return card.key === "newLeadCount" && props.newLeadHref ? (
          <Link
            aria-label={card.label}
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-orange-300 hover:bg-orange-50"
            href={props.newLeadHref}
            key={card.key}
          >
            {content}
          </Link>
        ) : (
          <article
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
            key={card.key}
          >
            {content}
          </article>
        );
      })}
    </section>
  );
}
