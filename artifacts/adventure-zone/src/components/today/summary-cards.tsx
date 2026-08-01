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
    label: "Visible route warnings",
    tone: "text-amber-700",
  },
] as const;

export function SummaryCards(props: SummaryCardsProps) {
  return (
    <section aria-label="Today summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((card) => {
        const content = <>
          <p className="text-sm font-semibold text-slate-600">{card.label}</p>
          <p className={`mt-2 text-3xl font-bold tracking-tight ${card.tone}`}>
            {props[card.key]}
          </p>
        </>;
        return card.key === "newLeadCount" && props.newLeadHref ? (
          <Link
            aria-label={card.label}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange-300 hover:bg-orange-50"
            href={props.newLeadHref}
            key={card.key}
          >
            {content}
          </Link>
        ) : (
          <article
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            key={card.key}
          >
            {content}
          </article>
        );
      })}
    </section>
  );
}
