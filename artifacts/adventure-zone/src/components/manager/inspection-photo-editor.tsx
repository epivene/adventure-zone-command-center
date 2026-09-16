import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { ManagerSyncStatus } from "@/components/manager/manager-sync-status";
import { useManagerAuth } from "@/lib/manager-auth-context";
import {
  flushManagerBlobQueue,
  indexedDbManagerBlobStore,
  queueManagerBlob,
  type ManagerBlobStore,
} from "@/lib/manager-blob-queue";
import { type ManagerMutationStore } from "@/lib/manager-offline-db";
import {
  flushManagerMutationQueue,
  queueManagerMutation,
} from "@/lib/manager-sync-queue";
import { indexedDbManagerMutationStore } from "@/lib/manager-offline-db";
import { ellipseStyle, pointerEllipse, type PhotoEllipse } from "@/lib/inspection-photo-annotations";

type ManagerApi = <T>(path: string, options?: RequestInit) => Promise<T>;

type InspectionPhotoEditorContentProps = {
  inspectionId: string;
  entryId: string;
  legId: string;
  managerApi: ManagerApi;
  onSaved?: () => void;
  mutationStore?: ManagerMutationStore;
  blobStore?: ManagerBlobStore;
};

export function InspectionPhotoEditorContent({
  inspectionId,
  entryId,
  legId,
  managerApi,
  onSaved,
  mutationStore = indexedDbManagerMutationStore,
  blobStore = indexedDbManagerBlobStore,
}: InspectionPhotoEditorContentProps) {
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [ellipses, setEllipses] = useState<PhotoEllipse[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [syncState, setSyncState] = useState<"saved_offline" | "syncing" | "synced" | "needs_attention" | null>(null);
  const [error, setError] = useState("");
  const imageRef = useRef<HTMLImageElement>(null);
  const previewUrl = useMemo(() => file && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "", [file]);

  useEffect(() => () => {
    if (previewUrl && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function finishCircle(event: PointerEvent<HTMLDivElement>) {
    if (!drawing || !dragStart || !imageRef.current) return;
    const bounds = imageRef.current.getBoundingClientRect();
    const ellipse = pointerEllipse(dragStart, { x: event.clientX, y: event.clientY }, bounds);
    if (ellipse.radiusX > 0.005 && ellipse.radiusY > 0.005) setEllipses((current) => [...current, ellipse]);
    setDragStart(null);
  }

  async function save() {
    if (!file) return;
    setError("");
    setSyncState("syncing");
    const photoId = crypto.randomUUID();
    const clientMutationId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    try {
      await queueManagerMutation({
        id: clientMutationId,
        legId,
        method: "POST",
        path: `/manager/year-end-inspections/${inspectionId}/photos`,
        body: {
          id: photoId,
          clientMutationId,
          entryId,
          mimeType: file.type,
          description: description.trim(),
          annotations: { version: 1, ellipses },
        },
        createdAt,
      }, mutationStore);
      await queueManagerBlob({
        id: photoId,
        legId,
        receiptId: photoId,
        kind: "year_end_inspection_photo",
        inspectionId,
        entryId,
        photoId,
        blob: file,
        createdAt,
      }, blobStore);

      if (typeof navigator !== "undefined" && navigator.onLine) {
        await flushManagerMutationQueue(managerApi, mutationStore);
        await flushManagerBlobQueue(async (row) => {
          if (row.kind !== "year_end_inspection_photo" || !row.inspectionId || !row.photoId) return;
          await managerApi(`/manager/year-end-inspections/${row.inspectionId}/photos/${row.photoId}/image`, {
            method: "PUT",
            headers: { "Content-Type": row.blob.type },
            body: row.blob,
          });
        }, blobStore);
        setSyncState("synced");
      } else {
        setSyncState("saved_offline");
      }
      onSaved?.();
      setFile(null);
      setDescription("");
      setEllipses([]);
    } catch (saveError) {
      setSyncState("saved_offline");
      setError(saveError instanceof Error ? saveError.message : "Photo saved offline and will retry later");
      onSaved?.();
    }
  }

  return <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
    <label className="grid gap-1 text-sm font-semibold">
      Take or choose photo
      <input
        aria-label="Take or choose photo"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        type="file"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setEllipses([]);
        }}
      />
    </label>
    {file ? <>
      <div
        className={`relative overflow-hidden rounded-lg bg-slate-100 ${drawing ? "cursor-crosshair touch-none" : ""}`}
        onPointerDown={(event) => drawing && setDragStart({ x: event.clientX, y: event.clientY })}
        onPointerUp={finishCircle}
      >
        {previewUrl
          ? <img ref={imageRef} alt="Inspection preview" className="block h-auto w-full" src={previewUrl} />
          : <div className="grid min-h-40 place-items-center text-sm text-slate-500">Photo selected: {file.name}</div>}
        {ellipses.map((ellipse) => <span
          key={ellipse.id}
          aria-label="Marked photo area"
          className="pointer-events-none absolute rounded-full border-4 border-rose-500"
          style={ellipseStyle(ellipse)}
        />)}
      </div>
      <label className="grid gap-1 text-sm font-semibold">
        Photo description
        <textarea
          aria-label="Photo description"
          className="min-h-24 rounded-lg border border-slate-300 p-2"
          placeholder="Describe the part and what the circle shows"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-lg border px-3 py-2 font-semibold" onClick={() => setDrawing((current) => !current)}>
          {drawing ? "Stop circling" : "Circle an area"}
        </button>
        <button type="button" className="rounded-lg border px-3 py-2 font-semibold" disabled={!ellipses.length} onClick={() => setEllipses((current) => current.slice(0, -1))}>Undo circle</button>
        <button type="button" className="rounded-lg border px-3 py-2 font-semibold" disabled={!ellipses.length} onClick={() => setEllipses([])}>Clear circles</button>
      </div>
      <button type="button" className="button-primary" onClick={() => void save()}>Save photo</button>
    </> : null}
    {syncState ? <ManagerSyncStatus state={syncState} /> : null}
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
  </section>;
}

export function InspectionPhotoEditor(props: Omit<InspectionPhotoEditorContentProps, "managerApi">) {
  const { managerApi } = useManagerAuth();
  return <InspectionPhotoEditorContent {...props} managerApi={managerApi} />;
}
