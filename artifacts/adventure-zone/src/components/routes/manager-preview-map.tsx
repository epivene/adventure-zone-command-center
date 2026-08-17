import { useEffect, useState } from "react";
import { apiGet } from "@/lib/auth-token";
import { ManagerScopedMap } from "@/components/manager/manager-scoped-map";
import type { ManagerScopedMapData } from "@/features/manager/manager-map-types";
import type { ManagerMapMode } from "@/features/routes/manager-map-navigation";

function formatEventDate(value: string | Date | null) {
  if (!value) return "Date not set";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not set";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function ManagerPreviewMap({ legId }: { legId: string }) {
  const [data, setData] = useState<ManagerScopedMapData | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<ManagerMapMode>("planning");

  useEffect(() => {
    setData(null);
    setError("");
    if (!legId) return;
    apiGet<ManagerScopedMapData>(`/manager-travel-admin/preview/${legId}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load manager preview"));
  }, [legId]);

  if (!legId) return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">Choose a manager to preview their private route map.</div>;
  if (error) return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading manager preview…</p>;

  return (
    <div className="grid gap-3">
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
        <strong>Read-only preview.</strong> This shows what {data.leg.name} can see, but admin actions here are not submitted as manager activity.
      </div>
      <ManagerScopedMap data={data} variant="operations" mode={mode} onModeChange={setMode} readOnlyPreview />

      <section className="rounded-xl border border-slate-200 bg-white p-3" aria-label="Manager preview scheduled events">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-bold">Scheduled events</h3>
          <span className="text-xs font-semibold text-slate-500">{data.events.length}</span>
        </div>
        {data.events.length ? (
          <ul className="mt-2 grid gap-2">
            {data.events.map((event) => {
              const mapped = event.latitude !== null && event.longitude !== null;
              return (
                <li className="rounded-lg border border-slate-100 p-3" key={event.bookingId}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-950">{event.bookingName}</p>
                      <p className="mt-0.5 text-sm text-slate-600">{[event.city, event.region].filter(Boolean).join(", ") || "Location not set"}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{formatEventDate(event.startsAt)}</p>
                    </div>
                    {!mapped ? <span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">Pin pending</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-500">No events are assigned to this leg yet.</p>}
      </section>
    </div>
  );
}
