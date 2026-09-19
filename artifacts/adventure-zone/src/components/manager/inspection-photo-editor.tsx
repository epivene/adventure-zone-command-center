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

const PHOTO_ISSUE_LABELS = [
  "Hole / tear",
  "Fraying",
  "Seam coming apart",
  "Part coming loose",
  "Falling off",
  "Zipper issue",
  "Velcro worn",
  "Anchor / D-ring damaged",
  "Mold / stain",
  "Needs cleaning",
  "Fading",
  "Missing part",
  "Water damage",
  "Patch needed",
  "Other",
] as const;

type InspectionPhotoEditorContentProps = {
  inspectionId: string;
  entryId: string;
  legId: string;
  managerApi: ManagerApi;
  onSaved?: () => void;
  mutationStore?: ManagerMutationStore;
  blobStore?: ManagerBlobStore;
  apiPrefix?: "/manager" | "/manager-admin";
};

export function InspectionPhotoEditorContent({
  inspectionId,
  entryId,
  legId,
  managerApi,
  onSaved,
  mutationStore = indexedDbManagerMutationStore,
  blobStore = indexedDbManagerBlobStore,
  apiPrefix = "/manager",
}: InspectionPhotoEditorContentProps) {
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [ellipses, setEllipses] = useState<PhotoEllipse[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [draftEllipse, setDraftEllipse] = useState<PhotoEllipse | null>(null);
  const [syncState, setSyncState] = useState<"saved_offline" | "syncing" | "synced" | "needs_attention" | null>(null);
  const [error, setError] = useState("");
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const drawingPathRef = useRef<Array<{ x: number; y: number }>>([]);
  const drawingPointerRef = useRef<number | null>(null);
  const adminUploadIdsRef = useRef<{ photoId: string; clientMutationId: string } | null>(null);
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
    const uploadIds = apiPrefix === "/manager-admin"
      ? adminUploadIdsRef.current ?? { photoId: crypto.randomUUID(), clientMutationId: crypto.randomUUID() }
      : { photoId: crypto.randomUUID(), clientMutationId: crypto.randomUUID() };
    if (apiPrefix === "/manager-admin") adminUploadIdsRef.current = uploadIds;
    const { photoId, clientMutationId } = uploadIds;
    const createdAt = new Date().toISOString();
    const savedDescription = [
      selectedLabels.length ? `Issues: ${selectedLabels.join(", ")}` : "",
      description.trim(),
    ].filter(Boolean).join("\n");
    try {
      if (apiPrefix === "/manager-admin") {
        await managerApi(`${apiPrefix}/year-end-inspections/${inspectionId}/photos`, {
          method: "POST",
          body: JSON.stringify({
            id: photoId,
            clientMutationId,
            entryId,
            mimeType: file.type,
            description: savedDescription,
            annotations: { version: 1, ellipses },
          }),
        });
        await managerApi(`${apiPrefix}/year-end-inspections/${inspectionId}/photos/${photoId}/image`, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        setSyncState("synced");
        onSaved?.();
        adminUploadIdsRef.current = null;
        setFile(null);
        setDescription("");
        setSelectedLabels([]);
        setEllipses([]);
        return;
      }

      await queueManagerMutation({
        id: clientMutationId,
        legId,
        method: "POST",
        path: `${apiPrefix}/year-end-inspections/${inspectionId}/photos`,
        body: {
          id: photoId,
          clientMutationId,
          entryId,
          mimeType: file.type,
          description: savedDescription,
          annotations: { version: 1, ellipses },
        },
        createdAt,
      }, mutationStore);
      await queueManagerBlob({
        id: photoId,
        legId,
        receiptId: clientMutationId,
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
          if (!row.inspectionId || !row.photoId) throw new Error("Inspection photo is missing inspection context");
          await managerApi(`${apiPrefix}/year-end-inspections/${row.inspectionId}/photos/${row.photoId}/image`, {
            method: "PUT",
            headers: { "Content-Type": row.blob.type },
            body: row.blob,
          });
        }, blobStore, async (row) => row.kind === "year_end_inspection_photo");
        setSyncState("synced");
      } else {
        setSyncState("saved_offline");
      }
      onSaved?.();
      setFile(null);
      setDescription("");
      setSelectedLabels([]);
      setEllipses([]);
    } catch (saveError) {
      if (apiPrefix === "/manager-admin") {
        setSyncState("needs_attention");
        setError(saveError instanceof Error ? saveError.message : "Photo upload failed. Keep this photo selected and try again.");
        return;
      }
      setSyncState("saved_offline");
      setError(saveError instanceof Error ? saveError.message : "Photo saved offline and will retry later");
      onSaved?.();
    }
  }

  function selectPhoto(nextFile: File | null) {
    adminUploadIdsRef.current = null;
    setFile(nextFile);
    setSelectedLabels([]);
    setEllipses([]);
    clearDrawingGesture();
  }

  function toggleDrawing() {
    if (drawing) clearDrawingGesture();
    setDrawing((current) => !current);
  }

  function toggleIssueLabel(label: string) {
    setSelectedLabels((current) => current.includes(label)
      ? current.filter((value) => value !== label)
      : [...current, label]);
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
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold">Quick issue labels</legend>
        <p className="text-xs text-slate-500">Choose any that apply. They will be saved with your description.</p>
        <div className="flex flex-wrap gap-2">
          {PHOTO_ISSUE_LABELS.map((label) => {
            const selected = selectedLabels.includes(label);
            return <button
              key={label}
              type="button"
              aria-pressed={selected}
              className={`rounded-full border px-3 py-2 text-sm font-semibold ${selected ? "border-orange-600 bg-orange-50 text-orange-800" : "border-slate-300"}`}
              onClick={() => toggleIssueLabel(label)}
            >{label}</button>;
          })}
        </div>
      </fieldset>
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

