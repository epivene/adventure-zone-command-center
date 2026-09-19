import { useState } from "react";

import { InspectionPhotoEditorContent } from "@/components/manager/inspection-photo-editor";
import { ellipseStyle } from "@/lib/inspection-photo-annotations";
import type { InspectionCondition, ManagerApi, YearEndInspectionEntryDto } from "@/lib/year-end-inspections-api";

export type ResourceAssignmentInput =
  | { mode: "none" }
  | { mode: "existing"; resourceId: string }
  | { mode: "new"; resourceId: string; name: string };

type EntryPatch = Partial<Pick<YearEndInspectionEntryDto, "pieceCodeSnapshot" | "pieceNameSnapshot" | "entryState" | "condition" | "inspectionNotes" | "repairNeeded" | "repairNotes" | "retainForFutureUse">> & {
  resourceAssignment?: ResourceAssignmentInput;
};

const attentionConditions = new Set<InspectionCondition>(["minor_repair", "major_repair", "replace", "retired"]);

export function YearEndInspectionEntryCard({
  entry,
  inspectionId,
  legId,
  managerApi,
  onSave,
  onRemove,
  onPhotoSaved,
  resources = [],
  initiallyOpen = false,
  isOpen,
  onOpenChange,
  onSaved,
  saveLabel = "Save attraction inspection",
  readOnly = false,
  apiPrefix = "/manager",
}: {
  entry: YearEndInspectionEntryDto;
  inspectionId: string;
  legId: string;
  managerApi: ManagerApi;
  onSave: (entryId: string, patch: EntryPatch) => Promise<void>;
  onRemove?: (entryId: string) => Promise<void>;
  onPhotoSaved?: () => void;
  resources?: { id: string; name: string }[];
  initiallyOpen?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSaved?: (entryId: string) => void;
  saveLabel?: string;
  readOnly?: boolean;
  apiPrefix?: "/manager" | "/manager-admin";
}) {
  const [internalOpen, setInternalOpen] = useState(initiallyOpen);
  const [code, setCode] = useState(entry.pieceCodeSnapshot);
  const [name, setName] = useState(entry.pieceNameSnapshot);
  const [condition, setCondition] = useState<InspectionCondition | "">(entry.condition ?? "");
  const [notes, setNotes] = useState(entry.inspectionNotes ?? entry.repairNotes ?? "");
  const [resourceSelection, setResourceSelection] = useState(entry.resourceIdSnapshot ?? "none");
  const [newResourceName, setNewResourceName] = useState(entry.pieceNameSnapshot);
  const [savedPhotosOpen, setSavedPhotosOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [photoBusyId, setPhotoBusyId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const open = isOpen ?? internalOpen;

  function setOpen(next: boolean | ((current: boolean) => boolean)) {
    const resolved = typeof next === "function" ? next(open) : next;
    if (isOpen === undefined) setInternalOpen(resolved);
    onOpenChange?.(resolved);
  }

  async function save() {
    if (!condition || !code.trim() || !name.trim() || (resourceSelection === "new" && !newResourceName.trim())) return;
    setSaving(true);
    setSaveError("");
    try {
      await onSave(entry.id, {
        pieceCodeSnapshot: code.trim(),
        pieceNameSnapshot: name.trim(),
        entryState: "inspected",
        condition,
        inspectionNotes: notes.trim() || null,
        repairNeeded: attentionConditions.has(condition),
        repairNotes: attentionConditions.has(condition) ? notes.trim() || null : null,
        retainForFutureUse: condition !== "retired",
        resourceAssignment: resourceSelection === "new"
          ? { mode: "new", resourceId: crypto.randomUUID(), name: newResourceName.trim() }
          : resourceSelection === "none"
            ? { mode: "none" }
            : { mode: "existing", resourceId: resourceSelection },
      });
      setOpen(false);
      onSaved?.(entry.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save this attraction inspection.");
    } finally {
      setSaving(false);
    }
  }

  async function markNotPresent() {
    if (!code.trim() || !name.trim()) return;
    setSaving(true);
    setSaveError("");
    try {
      await onSave(entry.id, {
        pieceCodeSnapshot: code.trim(),
        pieceNameSnapshot: name.trim(),
        entryState: "not_present",
        condition: null,
        repairNeeded: false,
      });
      setOpen(false);
      onSaved?.(entry.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save this attraction inspection.");
    } finally {
      setSaving(false);
    }
  }

  async function editPhoto(photo: NonNullable<YearEndInspectionEntryDto["photos"]>[number]) {
    const description = window.prompt("Photo description", photo.description ?? "");
    if (description === null) return;
    setPhotoError("");
    setPhotoBusyId(photo.id);
    try {
      await managerApi(`${apiPrefix}/year-end-inspections/${inspectionId}/photos/${photo.id}`, {
        method: "PATCH",
        body: JSON.stringify({ description: description.trim() || null, annotations: photo.annotations }),
      });
      onPhotoSaved?.();
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Could not update the photo description.");
    } finally {
      setPhotoBusyId(null);
    }
  }

  async function deletePhoto(photoId: string) {
    if (!window.confirm("Delete this inspection photo?")) return;
    setPhotoError("");
    setPhotoBusyId(photoId);
    try {
      await managerApi(`${apiPrefix}/year-end-inspections/${inspectionId}/photos/${photoId}`, { method: "DELETE" });
      onPhotoSaved?.();
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Could not delete the photo.");
    } finally {
      setPhotoBusyId(null);
    }
  }

  const photoCount = entry.photos?.length ?? 0;
  const resourceLabel = entry.resourceNameSnapshot ? `Attraction: ${entry.resourceNameSnapshot}` : "No attraction assigned yet";
  const availableResources = entry.resourceIdSnapshot && entry.resourceNameSnapshot && !resources.some((resource) => resource.id === entry.resourceIdSnapshot)
    ? [{ id: entry.resourceIdSnapshot, name: entry.resourceNameSnapshot }, ...resources]
    : resources;
  const statusLabel = entry.entryState === "not_started"
    ? "Not started"
    : entry.entryState === "not_present"
      ? "Not present"
      : entry.repairNeeded
        ? "Needs attention"
        : entry.condition === "good"
          ? "All Good"
          : entry.condition === "needs_cleaning"
            ? "Needs cleaning"
            : "Inspected";

  return <article className="rounded-xl border border-slate-200 bg-white shadow-sm">
    <button
      type="button"
      className="flex min-h-16 w-full items-start justify-between gap-3 p-4 text-left"
      aria-expanded={open}
      aria-label={`${open ? "Close" : "Open"} ${entry.pieceCodeSnapshot} ${entry.pieceNameSnapshot}. ${resourceLabel}. ${statusLabel}. ${photoCount} photo${photoCount === 1 ? "" : "s"} saved`}
      onClick={() => setOpen((value) => !value)}
    >
      <span>
        <span className="block font-bold">{entry.pieceCodeSnapshot} {entry.pieceNameSnapshot}</span>
        <span className="block text-sm text-slate-600">{resourceLabel}</span>
        <span className="block text-xs font-semibold text-emerald-700">{photoCount} photo{photoCount === 1 ? "" : "s"} saved</span>
      </span>
      <span className="grid shrink-0 justify-items-end gap-2">
        <span className={`rounded-full px-2 py-1 text-xs font-bold ${entry.entryState === "not_started" ? "bg-slate-100" : entry.repairNeeded ? "bg-rose-100 text-rose-800" : entry.condition === "needs_cleaning" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
          {statusLabel}
        </span>
        <span aria-hidden="true" className="text-sm font-bold text-slate-500">{open ? "▲" : "▼"}</span>
      </span>
    </button>
    {open ? <div className="grid gap-3 border-t p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">Attraction code
          <input aria-label="Attraction code" disabled={readOnly} className="min-h-11 rounded-lg border px-3" value={code} onChange={(event) => setCode(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">Attraction name
          <input aria-label="Attraction name" disabled={readOnly} className="min-h-11 rounded-lg border px-3" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
      </div>
      <p className="text-xs text-slate-500">Name and code corrections also update this attraction for future inspections.</p>
      <label className="grid gap-1 text-sm font-semibold">Attraction assignment
        <select aria-label="Attraction assignment" disabled={readOnly} className="min-h-11 rounded-lg border p-2" value={resourceSelection} onChange={(event) => {
          const value = event.target.value;
          setResourceSelection(value);
          if (value === "new") setNewResourceName(name.trim() || entry.pieceNameSnapshot);
        }}>
          <option value="none">No attraction assigned yet</option>
          {availableResources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
          <option value="new">Create new attraction</option>
        </select>
      </label>
      {resourceSelection === "new" ? <label className="grid gap-1 text-sm font-semibold">New attraction name
        <input aria-label="New attraction name" disabled={readOnly} className="min-h-11 rounded-lg border px-3" value={newResourceName} onChange={(event) => setNewResourceName(event.target.value)} />
      </label> : null}
      <label className="grid gap-1 text-sm font-semibold">Condition
        <select aria-label="Condition" disabled={readOnly} className="min-h-11 rounded-lg border p-2" value={condition} onChange={(event) => setCondition(event.target.value as InspectionCondition)}>
          <option value="">Choose condition</option>
          <option value="good">Good</option>
          <option value="needs_cleaning">Needs cleaning</option>
          <option value="minor_repair">Minor repair</option>
          <option value="major_repair">Major repair</option>
          <option value="replace">Replace</option>
          <option value="retired">Retire attraction</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">Inspection notes
        <textarea aria-label="Inspection notes" disabled={readOnly} className="min-h-28 rounded-lg border p-2" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      {!readOnly ? <InspectionPhotoEditorContent
        inspectionId={inspectionId}
        entryId={entry.id}
        legId={legId}
        managerApi={managerApi}
        apiPrefix={apiPrefix}
        onSaved={onPhotoSaved}
      /> : null}
      {!readOnly ? <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" className="min-h-11 rounded-lg border font-semibold" disabled={!code.trim() || !name.trim() || saving} onClick={() => void markNotPresent()}>Mark not present</button>
        <button type="button" className="button-primary min-h-11" disabled={!condition || !code.trim() || !name.trim() || saving} onClick={() => void save()}>{saving ? "Saving…" : saveLabel}</button>
      </div> : null}
      {photoCount ? <section className="grid gap-3 rounded-xl border bg-slate-50 p-3" aria-label="Saved inspection photos">
        <button type="button" className="flex min-h-11 items-center justify-between rounded-lg border bg-white px-3 font-semibold" aria-expanded={savedPhotosOpen} onClick={() => setSavedPhotosOpen((value) => !value)}>
          {savedPhotosOpen ? `Hide saved photos (${photoCount})` : `View saved photos (${photoCount})`}
        </button>
        {savedPhotosOpen ? <div className="grid gap-3 sm:grid-cols-2">
          {entry.photos!.map((photo) => <figure key={photo.id} className="overflow-hidden rounded-lg border bg-white">
            <div className="relative">
              <img src={photo.signedUrl} alt={photo.description || `${entry.pieceCodeSnapshot} inspection photo`} className="block h-auto w-full" />
              {photo.annotations.ellipses.map((ellipse) => <span key={ellipse.id} aria-label="Marked photo area" className="pointer-events-none absolute rounded-full border-4 border-rose-500" style={ellipseStyle(ellipse)} />)}
            </div>
            {photo.description ? <figcaption className="p-3 text-sm">{photo.description}</figcaption> : null}
            {!readOnly ? <div className="flex gap-2 border-t p-2">
              <button type="button" disabled={photoBusyId === photo.id} className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => void editPhoto(photo)}>Edit description</button>
              <button type="button" disabled={photoBusyId === photo.id} className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-800" onClick={() => void deletePhoto(photo.id)}>Delete photo</button>
            </div> : null}
          </figure>)}
        </div> : null}
        {photoError ? <p role="alert" className="text-sm text-rose-700">{photoError}</p> : null}
      </section> : null}
      {saveError ? <p role="alert" className="text-sm text-rose-700">{saveError}</p> : null}
      {!readOnly && onRemove && entry.canRemoveAsAccidental ? <button
        type="button"
        className="min-h-11 rounded-lg border border-rose-300 font-semibold text-rose-800"
        disabled={removing}
        onClick={() => {
          if (!confirmingRemoval) {
            setConfirmingRemoval(true);
            return;
          }
          setRemoving(true);
          void onRemove(entry.id).finally(() => setRemoving(false));
        }}
      >{removing ? "Removing…" : confirmingRemoval ? "Confirm removal" : "Remove accidental attraction"}</button> : null}
    </div> : null}
  </article>;
}
