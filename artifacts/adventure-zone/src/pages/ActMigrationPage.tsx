import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
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

interface ActivityImportStreamResult {
  inserted: number;
  /** Already existed — conflict suppressed by idempotency key. */
  skipped: number;
  /** No resolvable local parent (entity not yet imported). */
  unlinked: number;
  errors: number;
}

interface ActivityImportResult {
  note: ActivityImportStreamResult;
  history: ActivityImportStreamResult;
  activity: ActivityImportStreamResult;
  errorMessage?: string;
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
  activityImport: ActivityImportResult | null;
}

interface StatusResponse {
  envConfigured: boolean;
  run: RunStatus | null;
}

// ─── Scan types ───────────────────────────────────────────────────────────────

interface ScanItem {
  streamType: "activity" | "note" | "history";
  actId: string;
  date: string | null;
  subject: string | null;
  body: string | null;
  contactName: string | null;
  companyName: string | null;
  matchedRoutes: string[];
}

interface RouteMatchGroup {
  routeName: string;
  items: ScanItem[];
}

interface ScanResult {
  ok: boolean;
  error?: string;
  totalScanned: number;
  routeCount: number;
  matched: RouteMatchGroup[];
  unmatched: ScanItem[];
  fromDate?: string;
  toDate?: string;
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

function actTypeLabel(streamType: string) {
  switch (streamType) {
    case "activity": return "Activity";
    case "note":     return "Note";
    case "history":  return "Email/History";
    default:         return streamType;
  }
}

function formatDate(date: string | null) {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch {
    return date;
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

function RunProgress({
  run,
  onReimportHistory,
  reimportingHistory,
  reimportError,
}: {
  run: RunStatus;
  onReimportHistory?: () => void;
  reimportingHistory?: boolean;
  reimportError?: string | null;
}) {
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

      {/* Activity import (notes / email history) */}
      {run.activityImport && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Activity history (notes &amp; emails)
            </p>
            {onReimportHistory && run.phase === "applied" && (
              <button
                onClick={onReimportHistory}
                disabled={reimportingHistory}
                className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50 transition"
                title="Re-run history import to link any remaining unresolved entries"
              >
                {reimportingHistory ? "Importing…" : "Re-run history import"}
              </button>
            )}
          </div>
          {reimportError && (
            <div className="mb-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              ✗ {reimportError}
            </div>
          )}
          {run.activityImport.errorMessage && (
            <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              ⚠ {run.activityImport.errorMessage}
            </div>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700">
            {(["note", "history", "activity"] as const).map((stream) => {
              const s = run.activityImport![stream];
              const label = stream === "note" ? "Notes" : stream === "history" ? "Email/History" : "Activities";
              const total = s.inserted + s.skipped + s.unlinked + s.errors;
              if (total === 0) return null;
              return (
                <span key={stream} className="flex flex-wrap items-center gap-1">
                  <span className="text-slate-500 font-medium">{label}:</span>
                  <strong className="text-green-700">{s.inserted.toLocaleString()} added</strong>
                  {s.skipped > 0 && (
                    <span className="text-slate-400">· {s.skipped} already imported</span>
                  )}
                  {s.unlinked > 0 && (
                    <span className="text-amber-600" title="Contact or booking not found — will link on a re-run once those records are imported">
                      · {s.unlinked} not yet linked
                    </span>
                  )}
                  {s.errors > 0 && (
                    <span className="text-red-500">· {s.errors} errors</span>
                  )}
                </span>
              );
            })}
            {(["note", "history", "activity"] as const).every(
              (s) => (run.activityImport![s].inserted + run.activityImport![s].skipped + run.activityImport![s].unlinked + run.activityImport![s].errors) === 0
            ) && (
              <span className="text-slate-400 italic">No history entries found in Act!</span>
            )}
          </div>
        </div>
      )}

      {/* Final summary */}
      {isComplete && (
        <div className={`rounded-lg px-4 py-3 text-sm border ${run.activityImport?.errorMessage ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-green-50 border-green-200 text-green-800"}`}>
          {run.activityImport?.errorMessage ? (
            <>
              <p className="font-semibold">Import complete — history partially loaded</p>
              <p className="mt-1">
                {run.snapshot.stagedRecords.toLocaleString()} records imported. Activity history
                import encountered an error (see above); all other data is available.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">Import finished successfully.</p>
              <p className="mt-1">
                {run.snapshot.stagedRecords.toLocaleString()} records imported. New places, contacts,
                bookings, and calling lists are now available in the app.
              </p>
            </>
          )}
          <Link
            href="/profiles"
            className={`mt-3 inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 ${run.activityImport?.errorMessage ? "bg-amber-700 hover:bg-amber-800 focus-visible:outline-amber-700" : "bg-green-700 hover:bg-green-800 focus-visible:outline-green-700"}`}
          >
            View Profiles →
          </Link>
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
  submitLabel,
}: {
  onSubmit: (creds: Credentials | null) => void;
  loading: boolean;
  error: string | null;
  submitLabel?: string;
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
        {loading ? "Running…" : (submitLabel ?? "Run import")}
      </button>
    </form>
  );
}

// ─── Scan results ─────────────────────────────────────────────────────────────

function ScanItemRow({ item }: { item: ScanItem }) {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">
        {actTypeLabel(item.streamType)}
      </td>
      <td className="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">
        {formatDate(item.date)}
      </td>
      <td className="py-2 pr-3 text-sm text-slate-700 max-w-xs">
        {item.subject ?? <span className="italic text-slate-400">—</span>}
      </td>
      <td className="py-2 text-xs text-slate-500">
        {item.contactName ?? item.companyName ?? <span className="italic text-slate-400">—</span>}
      </td>
    </tr>
  );
}

function RouteGroup({ group }: { group: RouteMatchGroup }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
      >
        <span className="font-semibold text-slate-800 text-sm">{group.routeName}</span>
        <span className="ml-3 flex items-center gap-2">
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
            {group.items.length} {group.items.length === 1 ? "match" : "matches"}
          </span>
          <span className="text-slate-400 text-xs">{collapsed ? "▶" : "▼"}</span>
        </span>
      </button>
      {!collapsed && (
        <div className="border-t border-slate-100 px-4 pb-3 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Type</th>
                <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
                <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Subject</th>
                <th className="py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Contact / Company</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((item) => (
                <ScanItemRow key={`${item.streamType}-${item.actId}`} item={item} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ScanResults({ result }: { result: ScanResult }) {
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);

  return (
    <div className="mt-4 space-y-4">
      {/* Summary */}
      <div className="flex flex-wrap gap-4 text-sm text-slate-600">
        <span>
          <strong className="text-slate-800">{result.totalScanned.toLocaleString()}</strong> Act! items scanned
        </span>
        <span>
          <strong className="text-slate-800">{result.routeCount.toLocaleString()}</strong> routes checked
        </span>
        <span>
          <strong className="text-orange-700">{result.matched.length}</strong> routes with matches
        </span>
        <span>
          <strong className="text-slate-800">{result.unmatched.length.toLocaleString()}</strong> unmatched items
        </span>
        {result.fromDate && result.toDate && (
          <span className="w-full text-xs text-slate-400">
            Date range: {formatDate(result.fromDate)} — {formatDate(result.toDate)}
          </span>
        )}
      </div>

      {result.matched.length === 0 && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-600">
          No Act! records matched any route names. Try broadening route names or check that Act! data is populated.
        </div>
      )}

      {/* Matched groups */}
      {result.matched.length > 0 && (
        <div className="space-y-2">
          {result.matched.map((group) => (
            <RouteGroup key={group.routeName} group={group} />
          ))}
        </div>
      )}

      {/* Unmatched collapsible */}
      {result.unmatched.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <button
            type="button"
            onClick={() => setUnmatchedOpen((o) => !o)}
            className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
          >
            <span className="text-sm font-medium text-slate-600">
              Unmatched items ({result.unmatched.length.toLocaleString()})
            </span>
            <span className="text-slate-400 text-xs">{unmatchedOpen ? "▼" : "▶"}</span>
          </button>
          {unmatchedOpen && (
            <div className="border-t border-slate-100 px-4 pb-3 overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Type</th>
                    <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
                    <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Subject</th>
                    <th className="py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Contact / Company</th>
                  </tr>
                </thead>
                <tbody>
                  {result.unmatched.map((item) => (
                    <ScanItemRow key={`${item.streamType}-${item.actId}`} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
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
  const [reimportingHistory, setReimportingHistory] = useState(false);
  const [reimportError, setReimportError] = useState<string | null>(null);

  // ─── Scan state ────────────────────────────────────────────────────────────
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  // Default date range: last 12 months → today
  const [scanFromDate, setScanFromDate] = useState<string>(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [scanToDate, setScanToDate] = useState<string>(() => {
    return new Date().toISOString().slice(0, 10);
  });

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

  // ─── Re-run history import ────────────────────────────────────────────────

  async function handleReimportHistory() {
    setReimportError(null);
    setReimportingHistory(true);
    try {
      const res = await apiFetch("/migration/act/import-history", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setReimportError(data.error ?? "History import failed");
        return;
      }
      // Refresh status to pick up updated counts
      await fetchStatus(runId ?? undefined);
    } catch (err) {
      setReimportError(err instanceof Error ? err.message : "History import failed");
    } finally {
      setReimportingHistory(false);
    }
  }

  // ─── Run scan ─────────────────────────────────────────────────────────────

  async function handleScan(creds: Credentials | null) {
    setScanError(null);
    setScanResult(null);
    setScanning(true);
    try {
      const body = {
        ...(creds ?? {}),
        fromDate: scanFromDate || undefined,
        toDate: scanToDate || undefined,
      };
      const res = await apiFetch("/migration/act/scan-routes", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ScanResult;
      if (!data.ok) {
        setScanError(data.error ?? "Scan failed");
        return;
      }
      setScanResult(data);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
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
      {run && (
        <RunProgress
          run={run}
          onReimportHistory={handleReimportHistory}
          reimportingHistory={reimportingHistory}
          reimportError={reimportError}
        />
      )}

      {/* Show form to start a new run — always visible so a stuck run never locks the UI */}
      {(
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-800">
            {isRunning ? "Start a fresh import" : run ? "Run another import" : "Start import"}
          </h2>
          {isRunning && (
            <p className="mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              An import is currently in progress above. Starting a new one will supersede it.
            </p>
          )}

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
              submitLabel={run ? "Run import again" : "Run import"}
            />
          )}
        </div>
      )}

      {/* ─── Calendar & Route Scan ─────────────────────────────────────── */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-base font-semibold text-slate-800">Calendar &amp; Route Scan</h2>
        <p className="mb-4 text-sm text-slate-600">
          Scan Act! activities, notes, and email history for mentions of known routes (organizations).
          Up to 500 items per stream are checked. No data is written.
        </p>

        {/* Date range */}
        <div className="mb-4 flex flex-wrap gap-4">
          <div className="flex-1 min-w-[140px]">
            <label className="block text-sm font-medium text-slate-700 mb-1">From date</label>
            <input
              type="date"
              value={scanFromDate}
              onChange={(e) => setScanFromDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-sm font-medium text-slate-700 mb-1">To date</label>
            <input
              type="date"
              value={scanToDate}
              onChange={(e) => setScanToDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
          </div>
        </div>

        {envConfigured ? (
          <div className="space-y-4">
            {scanError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {scanError}
              </div>
            )}
            <button
              type="button"
              disabled={scanning}
              onClick={() => handleScan(null)}
              className="w-full rounded-lg bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
            >
              {scanning ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Scanning Act! data…
                </span>
              ) : (
                scanResult ? "Scan again" : "Scan Act! Data"
              )}
            </button>
          </div>
        ) : (
          <CredentialsForm
            onSubmit={handleScan}
            loading={scanning}
            error={scanError}
            submitLabel={scanning ? "Scanning…" : "Scan Act! Data"}
          />
        )}

        {scanResult && <ScanResults result={scanResult} />}
      </div>
    </div>
  );
}
