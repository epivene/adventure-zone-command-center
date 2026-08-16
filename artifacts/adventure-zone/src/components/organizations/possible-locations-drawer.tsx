import { useCallback, useEffect, useState } from "react";

import { apiGet } from "@/lib/auth-token";
import { AddExistingProfile } from "./add-existing-profile";
import { PossibleLocationsSection } from "./possible-locations-section";

export function PossibleLocationsDrawer({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  const refreshCount = useCallback(() => {
    apiGet<{ rollup: { locationCount: number } }>(`/organizations/${orgId}/locations/rollup`)
      .then((result) => setCount(result.rollup?.locationCount ?? 0))
      .catch(() => setCount(null));
  }, [orgId]);

  useEffect(() => { refreshCount(); }, [refreshCount]);

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Possible locations</h2>
            <p className="mt-1 text-sm text-slate-600">
              {count === null ? "Open to view and manage locations." : `${count} possible location${count === 1 ? "" : "s"}`}
            </p>
          </div>
          <button className="button-secondary" onClick={() => setOpen(true)} type="button">
            Possible locations{count === null ? "" : ` (${count})`}
          </button>
        </div>
      </section>

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30" role="dialog" aria-modal="true" aria-label="Possible locations">
          <button className="absolute inset-0 cursor-default" aria-label="Close possible locations" onClick={() => setOpen(false)} type="button" />
          <aside className="relative z-10 h-full w-full overflow-y-auto bg-slate-50 p-4 shadow-2xl sm:max-w-2xl sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-orange-700">Profile locations</p>
                <h2 className="text-2xl font-bold">Possible locations</h2>
              </div>
              <button className="button-secondary" onClick={() => setOpen(false)} type="button">Close</button>
            </div>
            <div className="grid gap-4">
              <AddExistingProfile orgId={orgId} onAdded={refreshCount} />
              <PossibleLocationsSection orgId={orgId} />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
