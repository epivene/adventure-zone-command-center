import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  createDriveBackupRoot,
  getDriveBackupStatus,
  pauseDriveBackupBackfill,
  previewDriveBackup,
  resumeDriveBackupBackfill,
  retryDriveBackupFailures,
  startDriveBackupBackfill,
  startDriveBackupPilot,
  type DriveBackupPreview,
  type DriveBackupStatus,
} from "@/features/google-drive-backup/google-drive-backup-client";

export function DriveBackupPage() {
  const [status, setStatus] = useState<DriveBackupStatus | null>(null);
  const [preview, setPreview] = useState<DriveBackupPreview | null>(null);
  const [pilotLimit, setPilotLimit] = useState(10);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setStatus(await getDriveBackupStatus()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load backup status."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!status || !["queued", "running"].includes(status.run?.state ?? "") &&
        !Object.entries(status.queue).some(([key, count]) => ["queued", "retry", "processing"].includes(key) && count > 0)) return;
    const id = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(id);
  }, [status, load]);

  async function action(name: string, work: () => Promise<unknown>) {
    setBusy(name); setError(null);
    try { await work(); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Backup action failed."); }
    finally { setBusy(null); }
  }

  const confirmed = (message: string, work: () => Promise<unknown>) =>
    window.confirm(message) ? work() : Promise.resolve();
  const successfulPilot = Boolean(status?.config && status.run?.mode === "pilot" && status.run.state === "completed");

  return <div className="mx-auto grid max-w-5xl gap-5 pb-10">
    <header>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Settings</p>
      <h1 className="mt-1 text-3xl font-bold">Google Drive backup</h1>
      <p className="mt-2 max-w-3xl text-slate-600">Writes only inside the Command Center backup folder. Amy’s Drive folders are never changed.</p>
      <Link className="mt-2 inline-block text-sm font-semibold text-orange-700 underline" href="/settings/google-workspace">Google Workspace settings</Link>
    </header>
    {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800" role="alert">{error}</div> : null}

    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Connection and backup folder</h2>
      <p className="mt-2 text-sm text-slate-600">{status?.connection ? `${status.connection.email} — ${status.reconnectRequired ? "Reconnect required" : "Connected"}` : "Google is not connected."}</p>
      {status?.config.rootFolderId ? <a className="mt-3 inline-block font-semibold text-orange-700 underline" href={status.config.rootWebViewLink ?? "#"} rel="noreferrer" target="_blank">Open Command Center backup folder</a> :
        <button className="button-primary mt-3 px-4 py-2" disabled={!status?.scopeReady || busy !== null} onClick={() => void action("root", () => confirmed("Create a new, separate Adventure Zone Command Center Backup folder?", createDriveBackupRoot))} type="button">Create separate backup folder</button>}
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Dry-run preview</h2>
      <p className="mt-1 text-sm text-slate-600">Counts and checks paths without writing anything to Drive.</p>
      <button className="button-secondary mt-3 px-4 py-2" disabled={!status?.config.rootFolderId || busy !== null} onClick={() => void action("preview", async () => setPreview(await previewDriveBackup()))} type="button">Run preview</button>
      {preview ? <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
        <div><b>{preview.profileCount}</b><br />profiles</div><div><b>{preview.followUpPdfCount}</b><br />follow-up PDFs</div><div><b>{preview.documentCount}</b><br />documents</div><div><b>{preview.needsFilingCount}</b><br />need filing</div>
        {preview.warnings.map((warning) => <p className="sm:col-span-4 text-amber-700" key={warning}>{warning}</p>)}
      </div> : null}
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Pilot and rollout</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold">Pilot profiles <input className="ml-2 w-20" max={25} min={1} onChange={(event) => setPilotLimit(Number(event.target.value))} type="number" value={pilotLimit} /></label>
        <button className="button-primary px-4 py-2" disabled={!preview || busy !== null || pilotLimit < 1 || pilotLimit > 25} onClick={() => void action("pilot", () => confirmed(`Start a pilot for exactly ${pilotLimit} profiles?`, () => startDriveBackupPilot(pilotLimit)))} type="button">Start pilot (max 25)</button>
        <button className="button-primary px-4 py-2" disabled={!successfulPilot || busy !== null} onClick={() => void action("backfill", () => confirmed("Start the paced full backup?", startDriveBackupBackfill))} type="button">Start full backup</button>
        {status?.run?.state === "running" || status?.run?.state === "queued" ? <button className="button-secondary px-4 py-2" onClick={() => void action("pause", pauseDriveBackupBackfill)} type="button">Pause</button> : null}
        {status?.run?.state === "paused" ? <button className="button-secondary px-4 py-2" onClick={() => void action("resume", resumeDriveBackupBackfill)} type="button">Resume</button> : null}
      </div>
      <p className="mt-3 text-sm text-slate-600">Current state: {status?.config.state ?? "loading"}{status?.run ? ` · ${status.run.mode} ${status.run.state}` : ""}</p>
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Health</h2>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">{Object.entries(status?.queue ?? {}).map(([name, count]) => <span key={name}><b>{count}</b> {name}</span>)}</div>
      <button className="button-secondary mt-4 px-4 py-2" disabled={busy !== null} onClick={() => void action("retry", retryDriveBackupFailures)} type="button">Retry blocked or failed exports</button>
    </section>
  </div>;
}

export default DriveBackupPage;
