import { useCallback, useEffect, useMemo, useState } from "react";

import { YearEndInspectionEntryCard } from "@/components/manager/year-end-inspection-entry-card";
import { YearEndInspectionProgress } from "@/components/manager/year-end-inspection-progress";
import {
  DiscoveredPieceForm,
  type DiscoveredPieceDraft,
  type LegInspectionResource,
} from "@/components/manager/discovered-piece-form";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { indexedDbManagerMutationStore, type ManagerMutationStore } from "@/lib/manager-offline-db";
import { flushManagerMutationQueue, queueManagerMutation } from "@/lib/manager-sync-queue";
import {
  progressForEntries,
  type ManagerApi,
  type YearEndInspectionDto,
  type YearEndInspectionEntryDto,
} from "@/lib/year-end-inspections-api";

type Filter = "all" | "not_started" | "inspected" | "attention" | "not_present";

export function ManagerYearEndInspectionContent({
  managerApi,
  legId,
  currentYear = new Date().getFullYear(),
  mutationStore = indexedDbManagerMutationStore,
}: {
  managerApi: ManagerApi;
  legId: string;
  currentYear?: number;
  mutationStore?: ManagerMutationStore;
}) {
  const [inspection, setInspection] = useState<YearEndInspectionDto | null>(null);
  const [priorInspection, setPriorInspection] = useState<YearEndInspectionDto | null>(null);
  const [resources, setResources] = useState<LegInspectionResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [newEntryId, setNewEntryId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [current, prior, resourceResponse] = await Promise.all([
        managerApi<{ inspection: YearEndInspectionDto | null }>(`/manager/year-end-inspections?year=${currentYear}`),
        managerApi<{ inspection: YearEndInspectionDto | null }>(`/manager/year-end-inspections?year=${currentYear - 1}`),
        managerApi<{ resources: LegInspectionResource[] }>("/manager/year-end-inspections/resources")
          .catch(() => ({ resources: [] })),
      ]);
      setInspection(current.inspection);
      setPriorInspection(prior.inspection);
      setResources(resourceResponse.resources);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the inspection");
    } finally {
      setLoading(false);
    }
  }, [currentYear, managerApi]);

  useEffect(() => { void load(); }, [load]);

  async function start(source: "current_pieces" | "blank" | "prior_year") {
    setStarting(true);
    setError("");
    try {
      const response = await managerApi<{ inspection: YearEndInspectionDto }>("/manager/year-end-inspections", {
        method: "POST",
        body: JSON.stringify({
          year: currentYear,
          source,
          sourceInspectionId: source === "prior_year" ? priorInspection?.id : undefined,
          clientMutationId: crypto.randomUUID(),
        }),
      });
      setInspection(response.inspection);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start the inspection");
    } finally {
      setStarting(false);
    }
  }

  async function saveEntry(entryId: string, patch: Partial<YearEndInspectionEntryDto>) {
    if (!inspection) return;
    const nextEntries = inspection.entries.map((entry) => entry.id === entryId ? { ...entry, ...patch } : entry);
    setInspection({ ...inspection, entries: nextEntries, progress: progressForEntries(nextEntries) });
    const mutationId = crypto.randomUUID();
    await queueManagerMutation({
      id: mutationId,
      legId,
      method: "PATCH",
      path: `/manager/year-end-inspections/${inspection.id}/entries/${entryId}`,
      body: patch,
      createdAt: new Date().toISOString(),
    }, mutationStore);
    if (typeof navigator === "undefined" || !navigator.onLine) {
      setNotice("Saved offline — will sync automatically");
      return;
    }
    const rows = await flushManagerMutationQueue(managerApi, mutationStore);
    const row = rows.find((candidate) => candidate.id === mutationId);
    setNotice(row?.state === "synced" ? "Saved and synced" : "Saved offline — will sync automatically");
    if (row?.state === "synced") {
      const refreshed = await managerApi<{ inspection: YearEndInspectionDto }>(`/manager/year-end-inspections/${inspection.id}`);
      if (refreshed.inspection) setInspection(refreshed.inspection);
    }
  }

  async function refreshInspectionPhotos() {
    if (!inspection) return;
    try {
      const refreshed = await managerApi<{ inspection: YearEndInspectionDto }>(`/manager/year-end-inspections/${inspection.id}`);
      if (refreshed.inspection) {
        setInspection(refreshed.inspection);
        setNotice("Photo saved and attached to this piece");
      }
    } catch {
      setNotice("Photo saved — it will appear here after syncing finishes");
    }
  }

  async function complete() {
    if (!inspection) return;
    try {
      const response = await managerApi<{ inspection: YearEndInspectionDto }>(`/manager/year-end-inspections/${inspection.id}/complete`, { method: "POST", body: "{}" });
      setInspection(response.inspection);
      setNotice("Inspection completed and sent to maintenance records");
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "Could not complete the inspection");
    }
  }

  async function addDiscoveredPiece(draft: DiscoveredPieceDraft) {
    if (!inspection) return;
    setError("");
    const pieceId = crypto.randomUUID();
    const entryId = crypto.randomUUID();
    const clientMutationId = crypto.randomUUID();
    const body = { ...draft, pieceId, entryId, clientMutationId };
    const path = `/manager/year-end-inspections/${inspection.id}/discovered-pieces`;
    setNewEntryId(entryId);
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await queueManagerMutation({
          id: clientMutationId,
          legId,
          method: "POST",
          path,
          body,
          createdAt: new Date().toISOString(),
        }, mutationStore);
        const optimisticEntry: YearEndInspectionEntryDto = {
          id: entryId,
          pieceId,
          pieceCodeSnapshot: draft.code || `NEW-${pieceId.slice(0, 8).toUpperCase()}`,
          pieceNameSnapshot: draft.name || "Unidentified inflatable piece",
          resourceNameSnapshot: resources.find((resource) => resource.id === draft.resourceId)?.name ?? null,
          entryState: "not_started",
          condition: null,
          inspectionNotes: draft.identityNotes,
          repairNeeded: false,
          repairNotes: null,
          retainForFutureUse: true,
        };
        const entries = [...inspection.entries, optimisticEntry];
        setInspection({ ...inspection, status: "in_progress", entries, progress: progressForEntries(entries) });
        setNotice("Piece saved offline — add its photos and notes now");
        return;
      }
      const response = await managerApi<{ inspection: YearEndInspectionDto }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setInspection(response.inspection);
      setNotice("Piece assigned to this leg — add its photos and inspection notes");
    } catch (addError) {
      setNewEntryId(null);
      setError(addError instanceof Error ? addError.message : "Could not add this piece");
      throw addError;
    }
  }

  const visibleEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return inspection?.entries.filter((entry) => {
      const matchesSearch = !query || `${entry.pieceCodeSnapshot} ${entry.pieceNameSnapshot} ${entry.resourceNameSnapshot ?? ""}`.toLowerCase().includes(query);
      const matchesFilter = filter === "all"
        || (filter === "attention" ? entry.repairNeeded : entry.entryState === filter);
      return matchesSearch && matchesFilter;
    }) ?? [];
  }, [filter, inspection, search]);

  if (loading) return <p className="text-sm text-slate-600">Loading year-end inspection…</p>;

  return <div className="grid gap-4 pb-24">
    <header>
      <p className="text-xs font-bold uppercase tracking-wider text-orange-700">End of season</p>
      <h1 className="text-2xl font-bold">{currentYear} Year-End Inspection</h1>
      <p className="mt-1 text-sm text-slate-600">Photograph, label, and inspect every inflatable piece you find. Each new piece is assigned to this leg as you go.</p>
    </header>
    {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-800">{error}</p> : null}
    {!inspection ? <section className="grid gap-3 rounded-xl border bg-white p-4">
      <h2 className="font-bold">Start this leg’s inspection</h2>
      <button type="button" className="button-primary min-h-12" disabled={starting} onClick={() => void start("blank")}>Start inspecting pieces</button>
      {priorInspection ? <button type="button" className="min-h-12 rounded-lg border font-semibold" disabled={starting} onClick={() => void start("prior_year")}>Copy {currentYear - 1} inspection list</button> : null}
      <button type="button" className="min-h-12 rounded-lg border font-semibold" disabled={starting} onClick={() => void start("current_pieces")}>Use pieces assigned to this leg</button>
      <p className="text-xs text-slate-500">No pieces need to be assigned ahead of time. Add and identify them one at a time during the inspection.</p>
    </section> : <>
      <YearEndInspectionProgress progress={inspection.progress} />
      <DiscoveredPieceForm resources={resources} disabled={inspection.status === "completed"} onAdd={addDiscoveredPiece} />
      <section className="grid gap-3 rounded-xl border bg-white p-3">
        <label className="grid gap-1 text-sm font-semibold">Search pieces
          <input className="min-h-11 rounded-lg border px-3" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Code, name, or attraction" />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Inspection filters">
          {(["all", "not_started", "inspected", "attention", "not_present"] as Filter[]).map((value) => <button
            type="button"
            key={value}
            className={`min-h-11 shrink-0 rounded-full border px-3 text-sm font-semibold ${filter === value ? "border-orange-600 bg-orange-50 text-orange-800" : ""}`}
            onClick={() => setFilter(value)}
          >{value.replace("_", " ")}</button>)}
        </div>
      </section>
      <section className="grid gap-3">
        {visibleEntries.map((entry) => <YearEndInspectionEntryCard
          key={entry.id}
          entry={entry}
          inspectionId={inspection.id}
          legId={legId}
          managerApi={managerApi}
          onSave={saveEntry}
          onPhotoSaved={() => void refreshInspectionPhotos()}
          initiallyOpen={entry.id === newEntryId}
        />)}
        {!visibleEntries.length ? <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">No pieces match this view.</p> : null}
      </section>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 p-3 backdrop-blur sm:static sm:rounded-xl sm:border">
        <button type="button" className="button-primary min-h-12 w-full" disabled={inspection.progress.total === 0 || inspection.progress.notStarted > 0 || inspection.status === "completed"} onClick={() => void complete()}>
          {inspection.status === "completed" ? "Inspection completed" : "Complete inspection"}
        </button>
      </div>
    </>}
    {notice ? <p role="status" className="text-sm font-semibold text-slate-700">{notice}</p> : null}
  </div>;
}

export default function ManagerYearEndInspectionPage() {
  const { manager, managerApi } = useManagerAuth();
  return <ManagerYearEndInspectionContent managerApi={managerApi} legId={manager?.legId ?? ""} />;
}
