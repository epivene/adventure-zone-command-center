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
import { ellipseStyle, pointerPathEllipse, type PhotoEllipse } from "@/lib/inspection-photo-annotations";

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
  const [draftEllipse, setDraftEllipse] = useState<PhotoEllipse | null>(null);
  const [syncState, setSyncState] = useState<"saved_offline" | "syncing" | "synced" | "needs_attention" | null>(null);
  const [error, setError] = useState("");
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const drawingPathRef = useRef<Array<{ x: number; y: number }>>([]);
  const drawingPointerRef = useRef<number | null>(null);
  const previewUrl = useMemo(() => file && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "", [file]);

  useEffect(() => () => {
    if (previewUrl && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function startCircle(event: PointerEvent<HTMLDivElement>) {
    if (!drawing) return;
    drawingPointerRef.current = event.pointerId;
    drawingPathRef.current = [{ x: event.clientX, y: event.clientY }];
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraftEllipse(null);
  }

  function updateCircle(event: PointerEvent<HTMLDivElement>) {
    if (!drawing || drawingPointerRef.current !== event.pointerId || !drawingPathRef.current.length) return;
    drawingPathRef.current = [...drawingPathRef.current, { x: event.clientX, y: event.clientY }];
    const ellipse = pointerPathEllipse(drawingPathRef.current, event.currentTarget.getBoundingClientRect(), "circle-preview");
    setDraftEllipse(ellipse.radiusX > 0.005 && ellipse.radiusY > 0.005 ? ellipse : null);
  }

  function clearDrawingGesture(target?: HTMLDivElement, pointerId?: number) {
    if (target && pointerId !== undefined && target.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    drawingPointerRef.current = null;
    drawingPathRef.current = [];
    setDraftEllipse(null);
  }

  function finishCircle(event: PointerEvent<HTMLDivElement>) {
    if (!drawing || drawingPointerRef.current !== event.pointerId || !drawingPathRef.current.length) return;
    drawingPathRef.current = [...drawingPathRef.current, { x: event.clientX, y: event.clientY }];
    const ellipse = pointerPathEllipse(drawingPathRef.current, event.currentTarget.getBoundingClientRect());
    if (ellipse.radiusX > 0.005 && ellipse.radiusY > 0.005) setEllipses((current) => [...current, ellipse]);
    clearDrawingGesture(event.currentTarget, event.pointerId);
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

  function selectPhoto(nextFile: File | null) {
    setFile(nextFile);
    setEllipses([]);
    clearDrawingGesture();
  }

  function toggleDrawing() {
    if (drawing) clearDrawingGesture();
    setDrawing((current) => !current);
  }

  return <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
    <div className="grid gap-2">
      <span className="text-sm font-semibold">Add a photo</span>
      <div className="grid grid-cols-2 gap-2">
        <button className="button-secondary" type="button" onClick={() => cameraRef.current?.click()}>Take Photo</button>
        <button className="button-secondary" type="button" onClick={() => galleryRef.current?.click()}>Choose From Gallery</button>
      </div>
      <input
        ref={cameraRef}
        className="sr-only"
        aria-label="Take inspection photo"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        type="file"
        onChange={(event) => selectPhoto(event.target.files?.[0] ?? null)}
      />
      <input
        ref={galleryRef}
        className="sr-only"
        aria-label="Choose inspection photo from gallery"
        accept="image/jpeg,image/png,image/webp"
        type="file"
        onChange={(event) => selectPhoto(event.target.files?.[0] ?? null)}
      />
    </div>
    {file ? <>
      <div
        aria-label="Photo annotation canvas"
        className={`relative overflow-hidden rounded-lg bg-slate-100 ${drawing ? "cursor-crosshair touch-none" : ""}`}
        onPointerDown={startCircle}
        onPointerMove={updateCircle}
        onPointerUp={finishCircle}
        onPointerCancel={(event) => clearDrawingGesture(event.currentTarget, event.pointerId)}
      >
        {previewUrl
          ? <img alt="Inspection preview" className="block h-auto w-full" src={previewUrl} />
          : <div className="grid min-h-40 place-items-center text-sm text-slate-500">Photo selected: {file.name}</div>}
        {ellipses.map((ellipse) => <span
          key={ellipse.id}
          aria-label="Marked photo area"
          className="pointer-events-none absolute rounded-full border-4 border-rose-500"
          style={ellipseStyle(ellipse)}
        />)}
        {draftEllipse ? <span
          aria-label="Circle preview"
          className="pointer-events-none absolute rounded-full border-4 border-dashed border-rose-500"
          style={ellipseStyle(draftEllipse)}
        /> : null}
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
        <button type="button" className="rounded-lg border px-3 py-2 font-semibold" onClick={toggleDrawing}>
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
