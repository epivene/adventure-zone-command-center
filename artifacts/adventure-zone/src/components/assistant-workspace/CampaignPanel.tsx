import type {
  CampaignBatch,
  CampaignReview,
} from "@/features/assistant-workspace/types";
export function CampaignPanel({
  batches,
  reviews,
  selectedBatchId,
  onRequest,
  busy,
}: {
  batches: CampaignBatch[];
  reviews: CampaignReview[];
  selectedBatchId?: string | null;
  onRequest: (message: string) => void;
  busy: boolean;
}) {
  if (!batches.length) return null;
  return (
    <section
      className="rounded-xl border bg-white p-4 text-sm"
      aria-label="Saved campaigns"
    >
      <h2 className="font-semibold">Saved lead batches</h2>
      <p className="mt-1 text-xs text-slate-600">
        Each group keeps its contacts and planning year. Drafts and sends are
        reviewed individually.
      </p>
      {batches.map((batch) => (
        <div key={batch.id} className="mt-4 border-t pt-3">
          <h3 className="font-medium">
            {batch.title} · {batch.eventYear}
          </h3>
          <p className="text-xs text-slate-600">{batch.criteria}</p>
          <p className="mt-2">
            {batch.cursor} of {batch.members.length} leads loaded in pages ·{" "}
            {Object.keys(batch.draftLinks).length} saved drafts
          </p>
          {selectedBatchId === batch.id ? (
            <>
              <p className="mt-1 text-xs text-teal-800">Selected batch</p>
              <button
                type="button"
                disabled={busy || batch.cursor >= batch.members.length}
                className="mt-2 rounded-lg border px-3 py-2 disabled:opacity-50"
                onClick={() =>
                  onRequest(
                    `Load the next 10 leads from saved campaign batch ${batch.id}, revision ${batch.revision}. Review current eligibility for that group before preparing any drafts.`,
                  )
                }
              >
                Next 10 leads
              </button>
              <button
                type="button"
                disabled={busy}
                className="ml-2 underline"
                onClick={() =>
                  onRequest(
                    "Clear the selected campaign batch so I can work on other profiles.",
                  )
                }
              >
                Leave batch
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              className="mt-2 underline"
              onClick={() =>
                onRequest(
                  `Resume saved campaign batch ${batch.id} and restore its latest group without advancing the page.`,
                )
              }
            >
              Resume batch
            </button>
          )}
          <ul className="mt-3 space-y-2">
            {reviews
              .filter((r) => r.batchId === batch.id)
              .map((r) => (
                <li
                  key={r.member.organizationId}
                  className="rounded-lg bg-slate-50 p-2"
                >
                  <a
                    href={`/profiles/${r.member.organizationId}`}
                    className="font-medium underline"
                  >
                    {r.profileName ?? "Customer profile"}
                  </a>
                  <p
                    className={r.eligible ? "text-teal-800" : "text-amber-800"}
                  >
                    {r.eligible ? "Eligible at last check" : "Needs review"}
                  </p>
                  {r.reasons.map((reason) => (
                    <p key={reason} className="text-xs text-amber-800">
                      {reason.replaceAll("_", " ")}
                    </p>
                  ))}
                  {r.cautions.map((c) => (
                    <p key={c} className="text-xs text-slate-600">
                      {c}
                    </p>
                  ))}
                  <p className="mt-1 text-xs text-slate-500">
                    Checked {new Date(r.checkedAt).toLocaleString()}; checked
                    again before creating a draft.
                  </p>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
