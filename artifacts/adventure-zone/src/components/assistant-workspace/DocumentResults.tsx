import type { DocumentResult } from "@/features/assistant-workspace/types";
const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
function ReadingStatus({
  cacheHit,
  extractedAt,
}: {
  cacheHit?: boolean;
  extractedAt?: string | null;
}) {
  return extractedAt ? (
    <p className="mt-1 text-xs text-slate-500">
      {cacheHit ? "Reused reading" : "Read"} ·{" "}
      {new Date(extractedAt).toLocaleString()}
    </p>
  ) : null;
}
export function DocumentResults({
  items,
  onOpen,
}: {
  items: DocumentResult[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="space-y-3" aria-label="Document evidence">
      {items.map((item) => (
        <section
          key={item.id}
          className="rounded-xl border bg-white p-4 text-sm"
        >
          {item.data.view === "document_reading" ? (
            <>
              <h3 className="font-semibold">{item.data.sourceLabel}</h3>
              <p className="my-2 text-xs text-slate-600">
                {item.data.eventYear ?? "Year unconfirmed"} ·{" "}
                {item.data.totalPages} page(s)
              </p>
              <p
                className={`text-xs ${item.data.complete ? "text-teal-800" : "text-amber-800"}`}
              >
                {item.data.complete
                  ? "All pages read"
                  : `Visual review needed${item.data.missingPages.length ? ` · Pages ${item.data.missingPages.join(", ")}` : ""}`}
              </p>
              <ReadingStatus
                cacheHit={item.data.cacheHit}
                extractedAt={item.data.extractedAt}
              />
              <p className="mt-2 text-xs text-slate-600">
                A reading does not verify signatures, payments or insurance
                coverage.
              </p>
              {item.data.documentId && (
                <button
                  className="mt-2 text-teal-800 underline"
                  onClick={() =>
                    onOpen((item.data as { documentId: string }).documentId)
                  }
                >
                  Open protected file
                </button>
              )}
            </>
          ) : item.data.view === "document_comparison" ? (
            <>
              <h3 className="font-semibold">Document sources</h3>
              <p className="my-2 text-xs text-slate-600">
                Reading these files does not verify signatures, payments or
                insurance coverage.
              </p>
              <ul className="space-y-3">
                {item.data.sources.map((s) => (
                  <li key={s.id} className="border-t pt-2">
                    <strong>{s.title}</strong>
                    <p className="text-xs text-slate-600">
                      {s.category.replaceAll("_", " ")} ·{" "}
                      {s.eventYear ?? "Year unconfirmed"} ·{" "}
                      {s.totalPages ?? "Unknown"} page(s)
                    </p>
                    <p
                      className={`mt-1 text-xs ${s.complete ? "text-teal-800" : "text-amber-800"}`}
                    >
                      {s.complete
                        ? "All pages read"
                        : s.missingPages.length
                          ? `Unreadable pages: ${s.missingPages.join(", ")} — visual review needed`
                          : "Source incomplete — review the original"}
                    </p>
                    <ReadingStatus
                      cacheHit={s.cacheHit}
                      extractedAt={s.extractedAt}
                    />
                    <button
                      type="button"
                      onClick={() => onOpen(s.id)}
                      className="mt-1 text-teal-800 underline"
                      aria-label={`Open ${s.title}`}
                    >
                      Open protected file
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : item.data.view === "public_research" ? (
            <>
              <h3 className="font-semibold">Public research</h3>
              <p className="mt-1 text-xs text-slate-600">
                {item.data.query} · {item.data.model}
              </p>
              {!item.data.complete && (
                <p className="mt-2 text-amber-800">Research incomplete</p>
              )}
              {item.data.parts.map((part, index) => (
                <div key={index} className="mt-3">
                  <p className="whitespace-pre-wrap">{part.text}</p>
                  <p className="mt-1 flex flex-wrap gap-2">
                    {part.citations.map((c, n) => (
                      <a
                        key={`${c.url}:${n}`}
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal-800 underline"
                      >
                        {c.title}
                      </a>
                    ))}
                  </p>
                </div>
              ))}
              <details className="mt-3">
                <summary>Consulted sources</summary>
                <ul>
                  {item.data.consultedSources.map((s) => (
                    <li key={s.url}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal-800 underline"
                      >
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
              {item.data.warnings.map((w) => (
                <p key={w} className="mt-2 text-xs text-amber-800">
                  {w}
                </p>
              ))}
            </>
          ) : (
            <>
              <h3 className="font-semibold">
                {item.data.profile.name} · {item.data.eventYear}
              </h3>
              <dl className="mt-2 grid grid-cols-2 gap-2">
                <dt>Outstanding</dt>
                <dd>{dollars(item.data.totals.outstandingCents)}</dd>
                <dt>Deposit remaining</dt>
                <dd>{dollars(item.data.totals.depositRemainingCents)}</dd>
                <dt>Recorded payments</dt>
                <dd>{dollars(item.data.totals.recordedPaidCents)}</dd>
              </dl>
              <p className="mt-2 text-xs text-slate-600">
                All bookings for this customer and year. Balances exclude drafts
                and cancelled invoices. Recorded payments include all nonvoided
                receipts.
              </p>
              {item.data.unclassified.invoices.length +
                item.data.unclassified.contracts.length >
                0 && (
                <p className="mt-2 text-xs text-amber-800">
                  {item.data.unclassified.invoices.length +
                    item.data.unclassified.contracts.length}{" "}
                  record(s) need an event year and are excluded from these
                  totals.
                </p>
              )}
              <a
                href={`/profiles/${item.data.profile.id}`}
                className="mt-2 inline-block text-teal-800 underline"
              >
                Open customer profile
              </a>
            </>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Saved snapshot
            {item.retrievedAt
              ? ` · ${new Date(item.retrievedAt).toLocaleString()}`
              : ""}
            . Ask to refresh for current information.
          </p>
        </section>
      ))}
    </div>
  );
}
