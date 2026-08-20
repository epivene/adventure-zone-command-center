export type PaperNoteHealthView = {
  configuration: {
    storageAvailable: boolean;
    aiAvailable: boolean;
    maxBatchPages: number;
    maxImageBytes: number;
    acceptedMimeTypes: readonly string[];
  };
  operations: {
    queuedPages: number;
    extractingPages: number;
    retryablePages: number;
    batchesWaitingForReview: number;
    importedBatchesLast24Hours: number;
    failedImportsLast24Hours: number;
    averagePageExtractionMs: number | null;
    malformedOutputRate: number | null;
    providerUnavailableRate: number | null;
  };
};

export function PaperNoteHealthBanner({ health }: { health: PaperNoteHealthView }) {
  const healthy = health.configuration.storageAvailable && health.configuration.aiAvailable;
  return (
    <section
      className={`mb-5 rounded-xl border p-4 ${healthy ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
      aria-label="Paper notes system status"
    >
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
        <span className={health.configuration.storageAvailable ? "text-emerald-900" : "text-amber-950"}>
          Private photo storage {health.configuration.storageAvailable ? "ready" : "unavailable"}
        </span>
        <span className={health.configuration.aiAvailable ? "text-emerald-900" : "text-amber-950"}>
          Handwriting AI {health.configuration.aiAvailable ? "ready" : "unavailable"}
        </span>
      </div>
      {!healthy ? (
        <p className="mt-2 text-sm text-amber-900">
          Saved batches stay available, but new photos may not upload or read until the unavailable service is restored.
        </p>
      ) : null}
      <p className={`mt-2 text-xs font-semibold ${healthy ? "text-emerald-800" : "text-amber-900"}`}>
        {health.operations.queuedPages} queued · {health.operations.extractingPages} reading · {health.operations.retryablePages} need attention
      </p>
    </section>
  );
}
