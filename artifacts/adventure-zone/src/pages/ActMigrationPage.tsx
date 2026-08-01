import { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/auth-token";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StreamProgress {
  streamType: string;
  completedCheckpoints: number;
  totalCheckpoints: number;
  stagedRecords: number;
  failedCheckpoints: number;
  errorCode: string | null;
}

interface RunStatus {
  runId: string;
  status: string;
  phase: "snapshotting" | "previewing" | "apply_gated" | "applying" | "partially_applied" | "applied" | "failed";
  pipelineError: string | null;
  snapshot: {
    completedCheckpoints: number;
    totalCheckpoints: number;
    stagedRecords: number;
    failedCheckpoints: number;
    streams: StreamProgress[];
    interruption: { code: string; retryable: boolean } | null;
  };
  preview: {
    total: number;
    entityCounts: Record<string, number>;
  } | null;
  apply: {
    status: string;
    counts: Record<string, number>;
    byTarget: Record<string, Record<string, number>>;
  } | null;
}

interface StatusResponse {
  envConfigured: boolean;
  run: RunStatus | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function streamLabel(type: string) {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function phaseLabel(phase: string) {
  switch (phase) {
    case "snapshotting":      return "Fetching from Act!…";
    case "previewing":        return "Matching records…";
    case "apply_gated":       return "Preview ready — apply is disabled";
    case "applying":          return "Writing to database…";
    case "partially_applied": return "Partially applied — some records failed";
    case "applied":           return "Import complete";
    case "failed":            return "Import failed";
    default:                  return "Running…";
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        className="h-full rounded-full bg-orange-500 transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StreamRow({ stream }: { stream: StreamProgress }) {
  const done = stream.completedCheckpoints >= stream.totalCheckpoints && stream.totalCheckpoints > 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-48 shrink-0 font-medium text-slate-700">
        {streamLabel(stream.streamType)}
      </span>
      <div className="flex-1">
        <ProgressBar value={stream.completedCheckpoints} max={Math.max(stream.totalCheckpoints, 1)} />
      </div>
      <span className="w-28 shrink-0 text-right text-slate-500">
        {stream.stagedRecords.toLocaleString()} records
      </span>
      {done && (
        <span className="text-green-600">✓</span>
      )}
      {stream.errorCode && (
        <span className="text-red-500 text-xs">{stream.errorCode}</span>
      )}
    </div>
  );
}

function RunProgress({ run }: { run: RunStatus }) {
  const isComplete = run.phase === "applied";
  const isFailed = run.phase === "failed";

  return (
    <div className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      {/* Phase header */}
      <div className="flex items-center gap-3">
        {!isComplete && !isFailed && (
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
        )}
        {isComplete && <span className="text-green-600 text-lg">✓</span>}
        {isFailed && <span className="text-red-600 text-lg">✗</span>}
        <h3 className={`font-semibold text-base ${isFailed ? "text-red-700" : isComplete ? "text-green-700" : "text-slate-800"}`}>
          {phaseLabel(run.phase)}
        </h3>
      </div>

      {run.pipelineError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {run.pipelineError}
        </div>
      )}

      {/* Snapshot streams */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Snapshot ({run.snapshot.stagedRecords.toLocaleString()} records fetched)
        </p>
        <div className="space-y-2">
          {run.snapshot.streams.length > 0 ? (
            run.snapshot.streams.map((s) => (
              <StreamRow key={s.streamType} stream={s} />
            ))
          ) : (
            <p className="text-sm text-slate-400 italic">Waiting for first page…</p>
          )}
        </div>
        {run.snapshot.interruption && (
          <p className="mt-2 text-xs text-amber-600">
            Interrupted: {run.snapshot.interruption.code}
            {run.snapshot.interruption.retryable && " (will retry)"}
          </p>
        )}
      </div>

      {/* Preview */}
      {run.preview && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Match preview
          </p>
          <div className="flex flex-wrap gap-4 text-sm text-slate-700">
            <span><strong>{run.preview.total.toLocaleString()}</strong> proposals</span>
            {Object.entries(run.preview.entityCounts).map(([k, v]) => (
              <span key={k}>{streamLabel(k)}: <strong>{(v as number).toLocaleString()}</strong></span>
            ))}
          </div>
        </div>
      )}

      {/* Apply */}
      {run.apply && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Apply — {run.apply.status}
          </p>
          <div className="flex flex-wrap gap-4 text-sm text-slate-700">
            {Object.entries(run.apply.counts)
              .filter(([, v]) => (v as number) > 0)
              .map(([k, v]) => (
                <span key={k}>{k}: <strong>{(v as number).toLocaleString()}</strong></span>
              ))}
          </div>
        </div>
      )}

      {/* Final summary */}
      {isComplete && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          <p className="font-semibold">Import finished successfully.</p>
          <p className="mt-1">
            {run.snapshot.stagedRecords.toLocaleString()} records imported. New places, contacts,
            bookings, and calling lists are now available in the app.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Credentials form ─────────────────────────────────────────────────────────

interface Credentials {
  baseUrl: string;
  databaseName: string;
  username: string;
  password: string;
}

function CredentialsForm({
  onSubmit,
  loading,
  error,
}: {
  onSubmit: (creds: Credentials | null) => void;
  loading: boolean;
  error: string | null;
}) {
  const [baseUrl, setBaseUrl] = useState("https://apius.act.com/act.web.api");
  const [databaseName, setDatabaseName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({ baseUrl, databaseName, username, password });
  }

  const inputCls =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200";
  const labelCls = "block text-sm font-medium text-slate-700 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={labelCls}>API Base URL</label>
        <input
          className={inputCls}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          required
          placeholder="https://apius.act.com/act.web.api"
        />
      </div>
      <div>
        <label className={labelCls}>Database name</label>
        <input
          className={inputCls}
          value={databaseName}
          onChange={(e) => setDatabaseName(e.target.value)}
          required
          placeholder="YourDatabaseName"
        />
      </div>
      <div>
        <label className={labelCls}>Username</label>
        <input
          className={inputCls}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
        />
      </div>
      <div>
        <label className={labelCls}>Password</label>
        <input
          className={inputCls}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
      </div>
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-50"
      >
        {loading ? "Starting…" : "Run import"}
      </button>
    </form>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ActMigrationPage() {
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Polling ─────────────────────────────────────────────────────────────

  const fetchStatus = async (targetRunId?: string) => {
    try {
      const path = targetRunId
        ? `/migration/act/status/${targetRunId}`
        : "/migration/act/status/latest";
      const res = await apiFetch(path);
      if (!res.ok) return;
      const data = (await res.json()) as StatusResponse;
      setStatusData(data);

      // Stop polling when terminal
      const phase = data.run?.phase;
      if (phase === "applied" || phase === "failed") {
        stopPolling();
      }
    } catch {
      // Network blip — keep polling
    }
  };

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling(id?: string) {
    stopPolling();
    pollRef.current = setInterval(() => fetchStatus(id), 3000);
  }

  // Load initial status on mount
  useEffect(() => {
    apiFetch("/migration/act/status/latest")
      .then((r) => r.json())
      .then((data: StatusResponse) => {
        setStatusData(data);
        // If there's an in-progress run, start polling
        const phase = data.run?.phase;
        if (phase && phase !== "applied" && phase !== "failed") {
          setRunId(data.run!.runId);
          startPolling(data.run!.runId);
        }
      })
      .catch(() => setLoadError("Could not connect to the API server."));

    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Start run ────────────────────────────────────────────────────────────

  async function handleStart(creds: Credentials | null) {
    setStartError(null);
    setStarting(true);
    try {
      const body = creds ?? {};
      const res = await apiFetch("/migration/act/start", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; runId?: string; error?: string };
      if (!data.ok || !data.runId) {
        setStartError(data.error ?? "Failed to start import");
        return;
      }
      setRunId(data.runId);
      startPolling(data.runId);
      // Immediately fetch first status
      await fetchStatus(data.runId);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start import");
    } finally {
      setStarting(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const run = statusData?.run ?? null;
  const envConfigured = statusData?.envConfigured ?? false;
  const isRunning =
    run &&
    run.phase !== "applied" &&
    run.phase !== "partially_applied" &&
    run.phase !== "apply_gated" &&
    run.phase !== "failed";

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-8 text-2xl font-bold text-slate-900">Act! CRM Import</h1>
      <p className="mt-2 text-slate-600">
        Pull all companies, contacts, opportunities, and groups from Act! into the Command Center.
        The import deduplicates places by name and city.
      </p>

      {loadError && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {/* Show the running/completed run */}
      {run && <RunProgress run={run} />}

      {/* Show form to start a new run */}
      {!isRunning && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-800">
            {run ? "Run another import" : "Start import"}
          </h2>

          {envConfigured ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Act! credentials are configured via environment variables. Click the button below
                to run the import.
              </p>
              {startError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {startError}
                </div>
              )}
              <button
                type="button"
                disabled={starting}
                onClick={() => handleStart(null)}
                className="w-full rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-50"
              >
                {starting ? "Starting…" : run ? "Run import again" : "Run import"}
              </button>
            </div>
          ) : (
            <CredentialsForm
              onSubmit={handleStart}
              loading={starting}
              error={startError}
            />
          )}
        </div>
      )}
    </div>
  );
}
