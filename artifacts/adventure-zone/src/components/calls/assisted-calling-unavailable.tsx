export function AssistedCallingUnavailable({ width = "max-w-7xl" }: { width?: string }) {
  return (
    <div className={`mx-auto ${width}`}>
      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="assisted-calling-unavailable-title">
        <h1 className="text-xl font-bold" id="assisted-calling-unavailable-title">Assisted calling is not enabled.</h1>
        <p className="mt-2 text-sm text-slate-600">Use Today for the existing follow-up workflow.</p>
        <a className="link mt-3 inline-block" href="/today">Return to Today</a>
      </section>
    </div>
  );
}
