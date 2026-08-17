import { Link } from "wouter";

export type PackageHistorySource = {
  bookingId: string;
  eventStartAt: string | null;
  label: string;
};

export type PackageHistorySignal =
  | {
      kind: "usual_package_mix";
      packageNames: string[];
      sourceBookingIds: string[];
    }
  | {
      kind: "main_attraction_difference";
      previousCount: number;
      currentCount: number;
      difference: number;
      sourceBookingId: string;
    }
  | {
      kind: "missing_prior_resource";
      resourceId: string;
      resourceName: string;
      sourceBookingId: string;
    }
  | {
      kind: "usual_event_month";
      month: number;
      sampleBookingIds: string[];
    };

export type PackageHistoryComparison = {
  currentBookingId: string;
  signals: PackageHistorySignal[];
  sources: PackageHistorySource[];
};

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function sourceIds(signal: PackageHistorySignal): string[] {
  switch (signal.kind) {
    case "usual_package_mix":
      return signal.sourceBookingIds;
    case "main_attraction_difference":
    case "missing_prior_resource":
      return [signal.sourceBookingId];
    case "usual_event_month":
      return signal.sampleBookingIds;
  }
}

function signalText(signal: PackageHistorySignal): string {
  switch (signal.kind) {
    case "usual_package_mix":
      return `They usually book ${signal.packageNames.join(" + ")}.`;
    case "main_attraction_difference": {
      const change = Math.abs(signal.difference);
      if (signal.difference === 0) {
        return `The most recent comparable booking also had ${signal.previousCount} main attractions.`;
      }
      return `The most recent comparable booking had ${signal.previousCount} main attractions; this booking has ${signal.currentCount} (${change} ${signal.difference > 0 ? "more" : "fewer"}).`;
    }
    case "missing_prior_resource":
      return `${signal.resourceName} was included on the most recent booking but is not selected on this one.`;
    case "usual_event_month":
      return `This event history usually falls in ${monthNames[signal.month - 1] ?? `month ${signal.month}`}.`;
  }
}

export function PackageHistorySignals({
  comparison,
}: {
  comparison: PackageHistoryComparison | null | undefined;
}) {
  if (!comparison || comparison.signals.length === 0) return null;

  const sourceById = new Map(
    comparison.sources.map((source) => [source.bookingId, source]),
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-orange-700">
          Previous booking patterns
        </p>
        <h2 className="mt-1 text-lg font-bold">Useful history for this event</h2>
        <p className="mt-1 text-sm text-slate-600">
          These are comparisons from saved bookings. Nothing is copied into this booking automatically.
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {comparison.signals.map((signal, index) => {
          const ids = sourceIds(signal);
          const sources = ids
            .map((id) => sourceById.get(id))
            .filter((source): source is PackageHistorySource => Boolean(source));
          return (
            <article className="rounded-lg border border-slate-200 p-4" key={`${signal.kind}-${index}`}>
              <p className="font-semibold text-slate-900">{signalText(signal)}</p>
              {sources.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {sources.slice(0, 3).map((source) => (
                    <Link className="link" href={`/bookings/${source.bookingId}`} key={source.bookingId}>
                      Based on {source.label}
                    </Link>
                  ))}
                  {sources.length > 3 ? (
                    <span className="text-slate-500">+{sources.length - 3} more</span>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
