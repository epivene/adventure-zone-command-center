import type { MasterWorkItem } from "@/features/today/master-work-types";

export function CompletedTodaySection({ items }: { items: MasterWorkItem[] }) {
  if (!items.length) return null;
  return (
    <details className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm">
      <summary className="cursor-pointer text-lg font-bold text-emerald-950">
        Completed Today <span className="ml-1 text-sm text-emerald-700">({items.length})</span>
      </summary>
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-emerald-200 bg-white p-3">
            <p className="font-bold text-slate-950">{item.eventName}</p>
            <p className="text-sm text-slate-600">{item.outcome ?? item.reason}</p>
            {item.completedAt ? <p className="mt-1 text-xs font-semibold text-emerald-700">Completed {new Date(item.completedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p> : null}
          </div>
        ))}
      </div>
    </details>
  );
}
