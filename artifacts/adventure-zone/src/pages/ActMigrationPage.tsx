import { useEffect, useRef, useState } from "react";
import { ExtractionProgress } from "@/components/act-replacement/extraction-progress";
import { ACT_PAGE_SIZES, getLatestRun, resumeRun, startRun, supersedeRun, type ActPageSize, type ActReplacementStatus } from "@/features/act-replacement/act-replacement-client";

export default function ActMigrationPage() {
  const [run, setRun] = useState<ActReplacementStatus | null>(null);
  const [pageSize, setPageSize] = useState<ActPageSize>(100);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const terminal = (phase: ActReplacementStatus["phase"]) => ["complete", "complete_with_issues", "failed", "superseded"].includes(phase);
  const refresh = async () => { try { const result = await getLatestRun(); setRun(result.run); if (!result.run || terminal(result.run.phase)) { if (poll.current) { clearInterval(poll.current); poll.current = null; } } else if (!poll.current) poll.current = setInterval(() => void refresh(), 3000); } catch (e) { setError(e instanceof Error ? e.message : "Could not load extraction status"); } };
  useEffect(() => { void refresh(); return () => { if (poll.current) clearInterval(poll.current); }; }, []);
  const schedulePolling = () => { if (!poll.current) poll.current = setInterval(() => void refresh(), 3000); };
  const applyActionResult = (next: ActReplacementStatus) => { setRun(next); if (terminal(next.phase)) { if (poll.current) { clearInterval(poll.current); poll.current = null; } } else schedulePolling(); };
  const runAction = async (action: () => Promise<{ run: ActReplacementStatus }>) => { setBusy(true); setError(null); try { applyActionResult((await action()).run); } catch (e) { setError(e instanceof Error ? e.message : "Action failed"); } finally { setBusy(false); } };
  const start = () => void runAction(() => startRun(pageSize));
  const startOver = () => { if (window.prompt('Type START OVER to confirm') === "START OVER" && run) void runAction(() => supersedeRun(run.runId)); };
  return <main className="mx-auto max-w-3xl px-4 pb-12"><h1 className="mt-8 text-2xl font-bold text-slate-900">Import everything from Act!</h1><p className="mt-2 text-slate-600">Fetch every available Act! record and safely archive it for review. This preview never writes to profiles.</p>{error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}{run && <ExtractionProgress status={run} onResume={() => void runAction(() => resumeRun(run.runId))} onStartOver={startOver} />}<section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><details><summary className="cursor-pointer text-sm font-semibold text-slate-800">Advanced settings</summary><label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="batch-size">Batch size</label><select id="batch-size" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value) as ActPageSize)} disabled={Boolean(run && !terminal(run.phase))} className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">{ACT_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select>{run && !terminal(run.phase) && <p className="mt-2 text-xs text-slate-500">Active run batch size is fixed at {run.pageSize}.</p>}</details><button type="button" disabled={busy || Boolean(run && !terminal(run.phase))} onClick={start} className="mt-5 w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Starting…" : "Import everything from Act!"}</button></section></main>;
}
