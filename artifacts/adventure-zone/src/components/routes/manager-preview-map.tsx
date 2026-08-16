import { useEffect, useState } from "react";
import { apiGet } from "@/lib/auth-token";
import { ManagerScopedMap } from "@/components/manager/manager-scoped-map";
import type { ManagerScopedMapData } from "@/features/manager/manager-map-types";
import type { ManagerMapMode } from "@/features/routes/manager-map-navigation";

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
    </div>
  );
}
