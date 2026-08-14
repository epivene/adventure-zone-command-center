import { useState } from "react";
import type { ActReplacementStatus } from "@/features/act-replacement/act-replacement-client";

function label(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function terminal(phase: ActReplacementStatus["phase"]) {
  return ["complete", "complete_with_issues", "failed", "superseded"].includes(
    phase,
  );
}

export function ExtractionProgress({
  status,
  profileImportStarted = false,
  allowStartOver = true,
  onResume,
  onStartOver,
}: {
  status: ActReplacementStatus;
  profileImportStarted?: boolean;
  allowStartOver?: boolean;
  onResume: () => void;
  onStartOver: () => void;
}) {
  const [diagnostics, setDiagnostics] = useState(false);
  const fetched = status.allStreams.observedIdentities;
  const archived = status.allStreams.archivedIdentities;
  const completedTasks = status.streams.reduce(
    (total, stream) => total + stream.completedCheckpoints,
    0,
  );
  const totalTasks = status.streams.reduce(
    (total, stream) => total + stream.totalCheckpoints,
    0,
  );
  const taskPercent =
    totalTasks === 0 ? 0 : Math.floor((completedTasks / totalTasks) * 100);
  return (
    <section
      className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      aria-label="Act extraction progress"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {terminal(status.phase)
              ? "Act! import preview"
              : "Fetching everything from Act!"}
          </h2>
          <p className="text-sm text-slate-600">{label(status.phase)}</p>
        </div>
        {!profileImportStarted && (
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            Preview only
          </span>
        )}
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Fetched</p>
          <p className="text-2xl font-semibold text-slate-900">
            {fetched.toLocaleString()} identities fetched
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Archived</p>
          <p className="text-2xl font-semibold text-slate-900">
            {archived.toLocaleString()} identities archived
          </p>
        </div>
      </div>
      {status.phase === "extracting" && totalTasks > 0 ? (
        <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50 p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="font-semibold text-blue-950">
              {completedTasks.toLocaleString()} of {totalTasks.toLocaleString()}{" "}
              extraction tasks finished
            </p>
            <span className="text-blue-800">{taskPercent}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Extraction tasks"
            aria-valuemin={0}
            aria-valuemax={totalTasks}
            aria-valuenow={completedTasks}
            className="h-2 overflow-hidden rounded-full bg-blue-100"
          >
            <div
              className="h-full rounded-full bg-blue-600 transition-[width]"
              style={{ width: `${taskPercent}%` }}
            />
          </div>
          <p className="text-xs text-blue-800">
            The identity count can stay unchanged while saved records are
            enriched and linked.
          </p>
        </div>
      ) : null}
      <div className="space-y-2">
        {status.streams.map((stream) => (
          <div
            key={stream.streamType}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm"
          >
            <span className="font-medium text-slate-700">
              {label(stream.streamType)}
            </span>
            <span className="text-slate-500">
              {stream.observedIdentities.toLocaleString()} Fetched ·{" "}
              {stream.archivedIdentities.toLocaleString()} Archived
            </span>
            {stream.error && (
              <span className="text-xs text-red-600">
                {stream.error.code}
                {stream.error.retryable ? " · retryable" : ""}
              </span>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="text-sm font-medium text-slate-700 underline"
        aria-expanded={diagnostics}
        onClick={() => setDiagnostics((open) => !open)}
      >
        Diagnostics {diagnostics ? "▲" : "▼"}
      </button>
      {diagnostics && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-4 text-xs text-slate-600">
          <p>
            Response rows: {status.allStreams.responseRows.toLocaleString()}
          </p>
          <p>
            Snapshot versions archived:{" "}
            {status.allStreams.snapshotVersionsInserted.toLocaleString()}
          </p>
          <p>
            Complete: {status.allStreams.completeIdentities.toLocaleString()} ·
            Partial: {status.allStreams.partialIdentities.toLocaleString()} ·
            Failed: {status.allStreams.failedIdentities.toLocaleString()}
          </p>
          <p>
            Relationship streams:{" "}
            {
              status.streams.filter(
                (stream) =>
                  stream.streamType.includes("_contact") ||
                  stream.streamType.includes("_company") ||
                  stream.streamType.includes("_opportunity"),
              ).length
            }
          </p>
          <p>
            Unsupported capabilities:{" "}
            {status.allStreams.unsupportedCapabilities.toLocaleString()}
          </p>
        </div>
      )}
      {!profileImportStarted &&
      (status.phase === "complete" ||
        status.phase === "complete_with_issues") ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          Everything fetched so far is safely archived. Nothing has been added
          to profiles yet.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {status.canResume && (
          <button
            type="button"
            onClick={onResume}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white"
          >
            Resume
          </button>
        )}
        {status.canStartOver && allowStartOver && (
          <button
            type="button"
            onClick={onStartOver}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Start over
          </button>
        )}
      </div>
    </section>
  );
}
