const labels: Record<string, string> = {
  prepared: "Ready for review",
  queued: "Queued",
  running: "Working",
  provider_started: "Checking result",
  succeeded: "Completed",
  partial: "Partly completed",
  blocked: "Needs information",
  uncertain: "Checking result",
  failed: "Failed",
  cancelled: "Stopped",
};
export function ActionResults({
  items,
  onApprove,
  onCheck,
  busy = false,
}: {
  items: {
    id: string;
    label: string;
    status: string;
    href: string | null;
    details?: unknown;
    trackingRepair?: boolean;
  }[];
  onApprove?: (id: string) => void;
  onCheck?: (id: string) => void;
  busy?: boolean;
}) {
  return (
    <ul className="space-y-3" aria-label="Action results">
      {items.map((item) => (
        <li
          key={item.id}
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm">{item.label}</strong>
            <span
              className={`rounded-full px-2 py-1 text-xs ${item.status === "succeeded" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`}
            >
              {item.trackingRepair
                ? "Sent · tracking needs repair"
                : (labels[item.status] ?? item.status)}
            </span>
          </div>
          {item.href && item.status === "succeeded" && (
            <a
              className="mt-2 inline-block text-sm text-teal-800 underline"
              href={item.href}
            >
              View result
            </a>
          )}
          {item.details != null && (
            <details className="mt-2 text-sm">
              <summary>Review changes</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-3 text-xs">
                {JSON.stringify(item.details, null, 2)}
              </pre>
            </details>
          )}
          {item.status === "prepared" && onApprove && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onApprove(item.id)}
              className="mt-3 rounded-lg bg-teal-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Approve this action
            </button>
          )}
          {(item.trackingRepair ||
            ["uncertain", "provider_started", "running"].includes(
              item.status,
            )) &&
            onCheck && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onCheck(item.id)}
                className="mt-3 rounded-lg border px-3 py-2 text-sm"
              >
                {item.trackingRepair ? "Repair tracking" : "Check result"}
              </button>
            )}
        </li>
      ))}
    </ul>
  );
}
