export function ManagerSyncStatus({state}:{state:"saved_offline"|"syncing"|"synced"|"needs_attention"}) {
  const label = state === "saved_offline" ? "Saved offline" : state === "syncing" ? "Syncing…" : state === "needs_attention" ? "Needs admin attention" : "Synced";
  return <span role="status" className="text-sm font-semibold text-slate-600">{label}</span>;
}
