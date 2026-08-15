import { useState } from "react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { flushManagerMutationQueue, queueManagerMutation } from "@/lib/manager-sync-queue";
import { ManagerSyncStatus } from "./manager-sync-status";

const kinds = [["wrong_datetime", "Wrong date/time"], ["wrong_location", "Wrong location"], ["wrong_leg", "Wrong leg"], ["route_problem", "Route problem"], ["event_details_changed", "Event details changed"], ["other", "Other"]] as const;

type SyncState = "saved_offline" | "syncing" | "synced" | "needs_attention";

export function ReportScheduleIssue({ bookingId = null, tripId = null }: { bookingId?: string | null; tripId?: string | null }) {
  const { manager, managerApi } = useManagerAuth();
  const [kind, setKind] = useState<string>("route_problem");
  const [notes, setNotes] = useState("");
  const [syncState, setSyncState] = useState<SyncState | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!manager) return;
    const clientMutationId = crypto.randomUUID();
    await queueManagerMutation({
      id: clientMutationId,
      legId: manager.legId,
      method: "POST",
      path: "/manager/issues",
      body: { bookingId, tripId, kind, notes, clientMutationId },
      createdAt: new Date().toISOString(),
    });
    setNotes("");
    setSyncState("saved_offline");
    if (navigator.onLine) {
      setSyncState("syncing");
      const rows = await flushManagerMutationQueue(managerApi);
      const row = rows.find((candidate) => candidate.id === clientMutationId);
      if (row) setSyncState(row.state);
    }
  }

  return <form id="report-schedule-issue" onSubmit={submit} className="grid gap-3 rounded-xl border bg-white p-4">
    <h2 className="font-bold">Report Schedule/Route Issue</h2>
    <p className="text-sm text-slate-600">Managers cannot edit the official schedule here. Send the problem to admin for review.</p>
    <label className="grid gap-1 text-sm font-semibold">Problem<select value={kind} onChange={(event) => setKind(event.target.value)}>{kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="grid gap-1 text-sm font-semibold">What needs fixing?<textarea value={notes} onChange={(event) => setNotes(event.target.value)} required rows={4} /></label>
    <button className="button-primary" disabled={!notes.trim()}>Report issue</button>
    {syncState ? <ManagerSyncStatus state={syncState} /> : null}
  </form>;
}
