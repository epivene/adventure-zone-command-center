import type { HistoricalEventDate } from "@/features/event-profiles/historical-event-dates";

export function HistoricalEventDates({ dates }: { dates: HistoricalEventDate[] }) {
  if (!dates.length) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Historical event dates</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Dates recovered from clearly labeled ACT notes. These are reference history, not current bookings.
          </p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
          ACT source
        </span>
      </div>

      <ul className="mt-3 grid gap-2">
        {dates.map((item, index) => (
          <li className="rounded-lg border border-border bg-muted p-3" key={`${item.dateText}-${index}`}>
            <p className="font-semibold text-foreground">{item.dateText}</p>
            <details className="mt-2 text-sm text-muted-foreground">
              <summary className="cursor-pointer font-semibold">Show source note</summary>
              <p className="mt-2 whitespace-pre-wrap">{item.sourceNote}</p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
