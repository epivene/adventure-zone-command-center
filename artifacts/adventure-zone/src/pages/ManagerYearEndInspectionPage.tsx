import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  YearEndInspectionEntryCard,
  type ResourceAssignmentInput,
} from "@/components/manager/year-end-inspection-entry-card";
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

type Filter = "all" | "not_started" | "good" | "needs_cleaning" | "attention" | "not_present";
type EntryPatch = Partial<YearEndInspectionEntryDto> & { resourceAssignment?: ResourceAssignmentInput };

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
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const loadRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setLoading(true);
    setError("");
    try {
      const [current, prior, resourceResponse] = await Promise.all([
        managerApi<{ inspection: YearEndInspectionDto | null }>(`/manager/year-end-inspections?year=${selectedYear}`),
        managerApi<{ inspection: YearEndInspectionDto | null }>(`/manager/year-end-inspections?year=${currentYear - 1}`),
        managerApi<{ resources: LegInspectionResource[] }>("/manager/year-end-inspections/resources")
          .catch(() => ({ resources: [] })),
      ]);
      if (requestId !== loadRequestRef.current) return;
      if (current.inspection && current.inspection.inspectionYear !== selectedYear) {
        throw new Error(`The server returned the wrong inspection year. Please reload ${selectedYear}.`);
      }
      setInspection(current.inspection);
      setPriorInspection(prior.inspection);
      setResources(resourceResponse.resources ?? []);
      setOpenEntryId(current.inspection?.status === "completed"
        ? null
        : current.inspection?.entries.find((entry) => entry.entryState === "not_started")?.id ?? null);
      setReviewing(false);
    } catch (loadError) {
      if (requestId !== loadRequestRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load the inspection");
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [currentYear, managerApi, selectedYear]);

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
      setOpenEntryId(response.inspection.entries.find((entry) => entry.entryState === "not_started")?.id ?? null);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start the inspection");
    } finally {
      setStarting(false);
    }
  }

  async function saveEntry(entryId: string, patch: EntryPatch) {
    if (!inspection) return;
    const nextEntries = inspection.entries.map((entry) => {
      if (entry.id !== entryId) return entry;
      const { resourceAssignment, ...entryPatch } = patch;
      if (!resourceAssignment) return { ...entry, ...entryPatch };
      if (resourceAssignment.mode === "none") {
        return { ...entry, ...entryPatch, resourceIdSnapshot: null, resourceNameSnapshot: null };
      }
      if (resourceAssignment.mode === "new") {
        setResources((current) => current.some((resource) => resource.id === resourceAssignment.resourceId)
          ? current
          : [...current, { id: resourceAssignment.resourceId, name: resourceAssignment.name }]);
        return { ...entry, ...entryPatch, resourceIdSnapshot: resourceAssignment.resourceId, resourceNameSnapshot: resourceAssignment.name };
      }
      return {
        ...entry,
        ...entryPatch,
        resourceIdSnapshot: resourceAssignment.resourceId,
        resourceNameSnapshot: resources.find((resource) => resource.id === resourceAssignment.resourceId)?.name ?? entry.resourceNameSnapshot,
      };
    });
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
        setNotice("Photo saved and attached to this attraction");
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
      setReviewing(false);
      setOpenEntryId(null);
      setNotice("Inspection completed and sent to maintenance records");
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "Could not complete the inspection");
    }
  }

  async function reopen() {
    if (!inspection) return;
    setError("");
    try {
      const response = await managerApi<{ inspection: YearEndInspectionDto }>(`/manager/year-end-inspections/${inspection.id}/reopen`, { method: "POST", body: "{}" });
      setInspection(response.inspection);
      setNotice("Inspection reopened — make changes, then review and finish again");
    } catch (reopenError) {
      setError(reopenError instanceof Error ? reopenError.message : "Could not reopen the inspection");
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
    setOpenEntryId(entryId);
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
          resourceIdSnapshot: draft.newResource?.id ?? draft.resourceId,
          resourceNameSnapshot: draft.newResource?.name ?? resources.find((resource) => resource.id === draft.resourceId)?.name ?? null,
          entryState: "not_started",
          condition: null,
          inspectionNotes: draft.identityNotes,
          repairNeeded: false,
          repairNotes: null,
          retainForFutureUse: true,
          canRemoveAsAccidental: true,
        };
        const entries = [...inspection.entries, optimisticEntry];
        setInspection({ ...inspection, status: "in_progress", entries, progress: progressForEntries(entries) });
        if (draft.newResource) setResources((current) => [...current, draft.newResource!]);
        setNotice("Attraction saved offline — add its photos and notes now");
        return;
      }
      const response = await managerApi<{ inspection: YearEndInspectionDto }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setInspection(response.inspection);
      if (draft.newResource) setResources((current) => current.some((resource) => resource.id === draft.newResource!.id) ? current : [...current, draft.newResource!]);
      setNotice("Attraction assigned to this leg — add its photos and inspection notes");
    } catch (addError) {
      setOpenEntryId(null);
      setError(addError instanceof Error ? addError.message : "Could not add this attraction");
      throw addError;
    }
  }

  async function removeDiscoveredPiece(entryId: string) {
    if (!inspection) return;
    setError("");
    try {
      const response = await managerApi<{ inspection: YearEndInspectionDto; deletedPhotos: number }>(
        `/manager/year-end-inspections/${inspection.id}/discovered-pieces/${entryId}`,
        { method: "DELETE" },
      );
      setInspection(response.inspection);
      setNotice("Accidental piece removed");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove this attraction");
      throw removeError;
    }
  }

  const visibleEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return inspection?.entries.filter((entry) => {
      const matchesSearch = !query || `${entry.pieceCodeSnapshot} ${entry.pieceNameSnapshot} ${entry.resourceNameSnapshot ?? ""}`.toLowerCase().includes(query);
      const matchesFilter = filter === "all"
        || (filter === "attention" ? entry.repairNeeded
          : filter === "good" ? entry.entryState === "inspected" && entry.condition === "good"
            : filter === "needs_cleaning" ? entry.entryState === "inspected" && entry.condition === "needs_cleaning"
              : entry.entryState === filter);
      return matchesSearch && matchesFilter;
    }) ?? [];
  }, [filter, inspection, search]);

  if (loading) return <p className="text-sm text-slate-600">Loading year-end inspection…</p>;

  const counts = {
    all: inspection?.entries.length ?? 0,
    not_started: inspection?.entries.filter((entry) => entry.entryState === "not_started").length ?? 0,
    good: inspection?.entries.filter((entry) => entry.entryState === "inspected" && entry.condition === "good").length ?? 0,
    needs_cleaning: inspection?.entries.filter((entry) => entry.entryState === "inspected" && entry.condition === "needs_cleaning").length ?? 0,
    attention: inspection?.entries.filter((entry) => entry.repairNeeded).length ?? 0,
    not_present: inspection?.entries.filter((entry) => entry.entryState === "not_present").length ?? 0,
  };
  const filterLabels: Record<Filter, string> = {
    all: "All",
    not_started: "To Inspect",
    good: "All Good",
    needs_cleaning: "Needs Cleaning",
    attention: "Needs Attention",
    not_present: "Not Present",
  };
  const yearOptions = Array.from({ length: 6 }, (_, index) => currentYear - index);

  function inspectNext(entryId: string) {
    if (!inspection) return;
    const currentIndex = inspection.entries.findIndex((entry) => entry.id === entryId);
    const ordered = [...inspection.entries.slice(currentIndex + 1), ...inspection.entries.slice(0, currentIndex)];
    setOpenEntryId(ordered.find((entry) => entry.entryState === "not_started")?.id ?? null);
  }

  return <div className="grid gap-4 pb-24">
    <header className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <div>
      <p className="text-xs font-bold uppercase tracking-wider text-orange-700">End of season</p>
      <h1 className="text-2xl font-bold">{selectedYear} Year-End Inspection</h1>
      <p className="mt-1 text-sm text-slate-600">Photograph, label, and inspect every attraction you find. New attractions are saved to this leg as you go.</p>
      </div>
      <label className="grid gap-1 text-sm font-semibold">Inspection year
        <select aria-label="Inspection year" className="min-h-11 rounded-lg border px-3" value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
          {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </label>
    </header>
    {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-800">{error}</p> : null}
    {!inspection ? <section className="grid gap-3 rounded-xl border bg-white p-4">
      <h2 className="font-bold">{selectedYear === currentYear ? "Start this leg’s inspection" : `No ${selectedYear} inspection was saved`}</h2>
      {selectedYear === currentYear ? <>
      <button type="button" className="button-primary min-h-12" disabled={starting} onClick={() => void start("current_pieces")}>Start {currentYear} inspection</button>
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer font-semibold">Other start options</summary>
        <div className="mt-3 grid gap-2">
          {priorInspection ? <button type="button" className="min-h-11 rounded-lg border font-semibold" disabled={starting} onClick={() => void start("prior_year")}>Copy {currentYear - 1} inspection list</button> : null}
          <button type="button" className="min-h-11 rounded-lg border font-semibold" disabled={starting} onClick={() => void start("blank")}>Start with an empty list</button>
        </div>
      </details>
      <p className="text-xs text-slate-500">Use the current leg list, then add any newly discovered attractions as you work.</p>
      </> : <button type="button" className="min-h-11 rounded-lg border font-semibold" onClick={() => setSelectedYear(currentYear)}>Return to {currentYear}</button>}
    </section> : <>
      {inspection.status === "completed" ? <section className="grid gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
        <h2 className="text-lg font-bold">Inspection complete</h2>
        <p className="text-sm text-emerald-900">This saved report remains available here. Reopen it if a name, condition, note, or photo needs changing.</p>
        <button type="button" className="min-h-11 rounded-lg border border-emerald-500 bg-white font-semibold" onClick={() => void reopen()}>Make changes</button>
      </section> : null}
      <YearEndInspectionProgress progress={inspection.progress} />
      {reviewing ? <section className="grid gap-3 rounded-xl border-2 border-orange-300 bg-orange-50 p-4">
        <h2 className="text-xl font-bold">Review inspection</h2>
        <p>All Good: {counts.good}</p>
        <p>Needs Cleaning: {counts.needs_cleaning}</p>
        <p>Needs Attention: {counts.attention}</p>
        <p>Not Present: {counts.not_present}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className="min-h-11 rounded-lg border bg-white font-semibold" onClick={() => setReviewing(false)}>Continue editing</button>
          <button type="button" className="button-primary min-h-11" onClick={() => void complete()}>Finish inspection</button>
        </div>
      </section> : <>
      <DiscoveredPieceForm resources={resources} disabled={inspection.status === "completed"} onAdd={addDiscoveredPiece} />
      <section className="grid gap-3 rounded-xl border bg-white p-3">
        <label className="grid gap-1 text-sm font-semibold">Search attractions
          <input className="min-h-11 rounded-lg border px-3" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Code, name, or attraction" />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Inspection filters">
          {(["all", "not_started", "good", "needs_cleaning", "attention", "not_present"] as Filter[]).map((value) => <button
            type="button"
            key={value}
            className={`min-h-11 shrink-0 rounded-full border px-3 text-sm font-semibold ${filter === value ? "border-orange-600 bg-orange-50 text-orange-800" : ""}`}
            onClick={() => setFilter(value)}
          >{filterLabels[value]} ({counts[value]})</button>)}
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
          onRemove={removeDiscoveredPiece}
          onPhotoSaved={() => void refreshInspectionPhotos()}
          resources={resources}
          isOpen={entry.id === openEntryId}
          onOpenChange={(nextOpen) => setOpenEntryId(nextOpen ? entry.id : null)}
          onSaved={inspectNext}
          saveLabel="Save & inspect next"
          readOnly={inspection.status === "completed"}
        />)}
        {!visibleEntries.length ? <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">No attractions match this view.</p> : null}
      </section>
      {inspection.status !== "completed" ? <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 p-3 backdrop-blur sm:static sm:rounded-xl sm:border">
        <button type="button" className="button-primary min-h-12 w-full" disabled={inspection.progress.total === 0 || inspection.progress.notStarted > 0} onClick={() => setReviewing(true)}>
          Review &amp; finish inspection
        </button>
      </div> : null}
      </>}
    </>}
    {notice ? <p role="status" className="text-sm font-semibold text-slate-700">{notice}</p> : null}
  </div>;
}

export default function ManagerYearEndInspectionPage() {
  const { manager, managerApi } = useManagerAuth();
  return <ManagerYearEndInspectionContent managerApi={managerApi} legId={manager?.legId ?? ""} />;
}
