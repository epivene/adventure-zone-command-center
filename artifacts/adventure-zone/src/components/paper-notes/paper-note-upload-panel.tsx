import { useMemo, useState } from "react";
import { Camera, ChevronDown, ChevronUp, FileImage, RotateCcw, Trash2 } from "lucide-react";

import {
  createPaperNoteBatch,
  createPaperNotePage,
  uploadPaperNotePageImage,
} from "@/features/paper-notes/paper-note-client";
import { uploadPaperNoteFiles } from "@/features/paper-notes/paper-note-upload-queue";
import type { PaperNoteUploadResult } from "@/features/paper-notes/paper-note-types";

type LocalFile = { key: string; file: File };
type FailedUpload = { index: number; pageId: string | null; error: string };

const accepted = new Set(["image/jpeg", "image/png", "image/webp"]);

export function PaperNoteUploadPanel({ onUploaded }: { onUploaded(batchId: string): void }) {
  const [name, setName] = useState("");
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [results, setResults] = useState<PaperNoteUploadResult[]>([]);
  const [failures, setFailures] = useState<FailedUpload[]>([]);
  const [progressText, setProgressText] = useState("");

  const allUploaded = results.length === files.length && results.length > 0 && results.every((result) => result.ok);
  const totalBytes = useMemo(() => files.reduce((sum, item) => sum + item.file.size, 0), [files]);

  function addFiles(list: FileList | null) {
    if (!list || busy || batchId) return;
    const next = [...list].filter((file) => accepted.has(file.type));
    const available = Math.max(0, 25 - files.length);
    setFiles((current) => [
      ...current,
      ...next.slice(0, available).map((file) => ({ key: crypto.randomUUID(), file })),
    ]);
    if (next.length !== list.length) setMessage("Only JPEG, PNG, and WebP photos were added.");
    else if (next.length > available) setMessage("A batch can contain up to 25 photos.");
    else setMessage("");
  }

  function move(index: number, direction: -1 | 1) {
    setFiles((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[target]] = [copy[target]!, copy[index]!];
      return copy;
    });
  }

  async function uploadAll() {
    if (!files.length || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const created = batchId ? { batchId } : await createPaperNoteBatch(name.trim() || null);
      if (!batchId) setBatchId(created.batchId);
      const uploadResults = await uploadPaperNoteFiles({
        batchId: created.batchId,
        files: files.map((item) => item.file),
        onProgress(update) {
          if (update.state === "creating_page") setProgressText(`Preparing ${update.index + 1} of ${update.total}…`);
          if (update.state === "uploading") setProgressText(`Uploading ${update.index + 1} of ${update.total}…`);
          if (update.state === "uploaded") setProgressText(`Saved ${update.index + 1} of ${update.total}`);
        },
      });
      setResults(uploadResults);
      const failed = uploadResults.flatMap((result, index) => result.ok ? [] : [{
        index,
        pageId: result.pageId,
        error: result.error ?? "Upload failed.",
      }]);
      setFailures(failed);
      if (!failed.length) onUploaded(created.batchId);
      else setMessage(`${failed.length} ${failed.length === 1 ? "photo needs" : "photos need"} another try.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The paper notes could not be uploaded.");
    } finally {
      setBusy(false);
      setProgressText("");
    }
  }

  async function retryFailure(failure: FailedUpload) {
    if (!batchId || busy) return;
    const local = files[failure.index];
    if (!local) return;
    setBusy(true);
    try {
      let pageId = failure.pageId;
      if (!pageId) {
        const created = await createPaperNotePage({
          batchId,
          filename: local.file.name,
          mimeType: local.file.type,
          sizeBytes: local.file.size,
        });
        pageId = created.pageId;
      }
      await uploadPaperNotePageImage({ batchId, pageId, file: local.file });
      const nextFailures = failures.filter((item) => item.index !== failure.index);
      setFailures(nextFailures);
      setResults((current) => current.map((result, index) => index === failure.index
        ? { ...result, ok: true, pageId, error: null }
        : result));
      if (!nextFailures.length) onUploaded(batchId);
    } catch (error) {
      setFailures((current) => current.map((item) => item.index === failure.index
        ? { ...item, error: error instanceof Error ? error.message : "Upload failed." }
        : item));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-orange-200 bg-orange-50/60 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-orange-100 p-2 text-orange-700"><Camera className="h-5 w-5" /></div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">New paper notes import</h2>
          <p className="mt-1 text-sm text-slate-600">Take photos or choose several call-sheet photos. Nothing is added to profiles yet.</p>
        </div>
      </div>

      <label className="mt-4 grid gap-1 text-sm font-semibold text-slate-700">
        Batch name <span className="font-normal text-slate-500">(optional)</span>
        <input
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
          disabled={busy || Boolean(batchId)}
          maxLength={160}
          onChange={(event) => setName(event.target.value)}
          placeholder="Old Monday call lists"
          value={name}
        />
      </label>

      {!batchId ? (
        <label className="mt-4 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-orange-300 bg-white px-4 py-3 text-sm font-bold text-orange-800 hover:bg-orange-50">
          <FileImage className="h-5 w-5" />
          Take photos / choose photos
          <input
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="sr-only"
            multiple
            onChange={(event) => { addFiles(event.currentTarget.files); event.currentTarget.value = ""; }}
            type="file"
          />
        </label>
      ) : null}

      {files.length ? (
        <div className="mt-4 grid gap-2">
          {files.map((item, index) => {
            const failure = failures.find((candidate) => candidate.index === index);
            return (
              <div className="rounded-xl border border-slate-200 bg-white p-3" key={item.key}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{index + 1}. {item.file.name}</p>
                    <p className="text-xs text-slate-500">{(item.file.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                  {!batchId ? (
                    <div className="flex gap-1">
                      <button aria-label={`Move ${item.file.name} up`} className="min-h-11 min-w-11 rounded-lg border border-slate-200" disabled={index === 0} onClick={() => move(index, -1)} type="button"><ChevronUp className="mx-auto h-4 w-4" /></button>
                      <button aria-label={`Move ${item.file.name} down`} className="min-h-11 min-w-11 rounded-lg border border-slate-200" disabled={index === files.length - 1} onClick={() => move(index, 1)} type="button"><ChevronDown className="mx-auto h-4 w-4" /></button>
                      <button aria-label={`Remove ${item.file.name}`} className="min-h-11 min-w-11 rounded-lg border border-rose-200 text-rose-700" onClick={() => setFiles((current) => current.filter((candidate) => candidate.key !== item.key))} type="button"><Trash2 className="mx-auto h-4 w-4" /></button>
                    </div>
                  ) : null}
                </div>
                {failure ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-50 p-2">
                    <p className="text-sm text-rose-800">{failure.error}</p>
                    <button className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 text-sm font-bold text-rose-800" disabled={busy} onClick={() => void retryFailure(failure)} type="button"><RotateCcw className="h-4 w-4" />Retry</button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {files.length ? <p className="mt-3 text-xs text-slate-500">{files.length}/25 photos · {(totalBytes / 1024 / 1024).toFixed(1)} MB total selected</p> : null}
      {progressText ? <p aria-live="polite" className="mt-3 text-sm font-semibold text-orange-800">{progressText}</p> : null}
      {message ? <p className="mt-3 text-sm text-rose-800" role="alert">{message}</p> : null}

      {!allUploaded && !batchId ? (
        <button
          className="mt-4 min-h-12 w-full rounded-xl bg-orange-600 px-4 py-3 font-bold text-white hover:bg-orange-700 disabled:opacity-50"
          disabled={!files.length || busy}
          onClick={() => void uploadAll()}
          type="button"
        >
          {busy ? "Saving photos…" : `Save ${files.length || ""} ${files.length === 1 ? "photo" : "photos"}`}
        </button>
      ) : null}
    </section>
  );
}
