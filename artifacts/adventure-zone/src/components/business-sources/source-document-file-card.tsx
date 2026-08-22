import { useState } from "react";

import { apiFetch, apiPost } from "@/lib/auth-token";

export type SourceFileMetadata = {
  id: string;
  mimeType: string;
  originalSizeBytes: number;
  sha256Hex: string;
  uploadedBy: string;
  uploadedAt: string;
};

const acceptedMimeTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

export function SourceDocumentFileCard({
  documentId,
  file,
  onChanged,
}: {
  documentId: string;
  file: SourceFileMetadata | null;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(selected: File | undefined) {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(`/business-sources/${documentId}/file`, {
        method: "PUT",
        headers: { "Content-Type": selected.type || "application/octet-stream" },
        body: selected,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `Upload failed (${response.status})`);
      }
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload the source document.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!file || busy) return;
    if (!window.confirm("Remove the protected file from this source record? The reviewed source metadata and terms will remain.")) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(`/business-sources/${documentId}/file`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "Could not remove the source document file.");
      }
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the source document file.");
    } finally {
      setBusy(false);
    }
  }

  async function open() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const { url } = await apiPost<{ url: string }>(`/business-sources/${documentId}/file/open`, {});
      if (!url) throw new Error("The protected document did not return a signed file link.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the source document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold">Protected file</p>
          <p className="text-xs text-slate-600">
            {file ? `Uploaded · ${Math.max(1, Math.round(file.originalSizeBytes / 1024))} KB` : "Not uploaded"}
          </p>
        </div>
        {file ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">Uploaded</span> : null}
      </div>

      <label className="text-sm font-semibold">
        Upload or replace file
        <input
          accept={`${acceptedMimeTypes},.pdf,.docx,.xlsx`}
          className="mt-1 block w-full text-sm font-normal"
          disabled={busy}
          onChange={(event) => void upload(event.currentTarget.files?.[0])}
          type="file"
        />
      </label>

      {file ? (
        <div className="flex flex-wrap gap-2">
          <button className="button-secondary" disabled={busy} onClick={() => void open()} type="button">Open document</button>
          <button className="button-secondary" disabled={busy} onClick={() => void remove()} type="button">Remove file</button>
        </div>
      ) : null}
      {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
    </div>
  );
}
