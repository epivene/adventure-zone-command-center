export function ManagerSyncStatus({state}:{state:"saved_offline"|"syncing"|"synced"|"needs_attention"}) {
  const label = state === "saved_offline"
    ? "Saved offline — will sync automatically"
    : state === "syncing"
      ? "Saving and syncing…"
      : state === "needs_attention"
        ? "Save needs attention"
        : "Saved and synced";
  const classes = state === "synced"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : state === "saved_offline"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : state === "needs_attention"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-sky-200 bg-sky-50 text-sky-800";
  return <div role="status" className={`rounded-xl border px-4 py-3 text-sm font-bold ${classes}`}>{label}</div>;
}
