function SummaryTotal({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4 text-center">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold text-slate-900">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

export function ImportSummary({
  applied,
  alreadyPresent,
  blocked,
  failed,
  remainingReview,
}: {
  applied: number;
  alreadyPresent: number;
  blocked: number;
  failed: number;
  remainingReview: number;
}) {
  return (
    <section
      className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      aria-labelledby="act-import-summary-heading"
    >
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-orange-700">
          Finish
        </p>
        <h2
          id="act-import-summary-heading"
          className="mt-1 text-xl font-semibold text-slate-900"
        >
          Import summary
        </h2>
      </header>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTotal label="Applied" value={applied} />
        <SummaryTotal label="Already present" value={alreadyPresent} />
        <SummaryTotal label="Blocked" value={blocked} />
        <SummaryTotal label="Failed" value={failed} />
      </dl>
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
        {remainingReview.toLocaleString()}{" "}
        {remainingReview === 1 ? "record still needs" : "records still need"}{" "}
        review
      </p>
    </section>
  );
}
