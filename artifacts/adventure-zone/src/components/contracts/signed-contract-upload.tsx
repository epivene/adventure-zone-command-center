import { useState } from "react";

import { contractClient } from "@/features/contracts/contract-client";

type StoredSignedFile = { id: string; originalFilename: string; revision: number; confirmedAt: string | null };

export function SignedContractUpload({ contractVersionId, versionNumber, onCompleted }: {
  contractVersionId: string;
  versionNumber: number;
  onCompleted(): void;
}) {
  const [selected, setSelected] = useState<File | null>(null);
  const [stored, setStored] = useState<StoredSignedFile | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!selected || busy) return;
    if (selected.type !== "application/pdf") {
      setError("Choose the completed agreement as a PDF.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await contractClient.uploadSignedPdf(contractVersionId, selected);
      setStored(result.file as StoredSignedFile);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not upload the signed PDF.");
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!stored || !confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await contractClient.confirmSignedFile(contractVersionId, stored.id, true);
      onCompleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not confirm the signed contract.");
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <h2 className="text-lg font-bold">Upload completed signed contract</h2>
      <p className="text-sm text-slate-700">Contract version {versionNumber}</p>
      <label className="grid gap-1 text-sm font-semibold">Signed contract PDF
        <input accept="application/pdf,.pdf" aria-label="Signed contract PDF" onChange={(event) => {
          setSelected(event.target.files?.[0] ?? null);
          setStored(null);
          setConfirmed(false);
        }} type="file" />
      </label>
      {selected ? <p className="text-sm"><strong>{selected.name}</strong> · {(selected.size / 1024).toFixed(1)} KB</p> : null}
      {!stored ? <button className="button-primary min-h-11" disabled={!selected || busy} onClick={() => void upload()} type="button">{busy ? "Uploading…" : "Upload signed PDF"}</button> : <>
        <p className="text-sm font-semibold text-emerald-800">Signed PDF revision {stored.revision} stored</p>
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
          <input aria-label="I confirm this is the completed signed agreement" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
          I confirm this is the completed signed agreement
        </label>
        <button className="button-primary min-h-11" disabled={!confirmed || busy} onClick={() => void complete()} type="button">Confirm completed contract</button>
      </>}
      {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
    </section>
  );
}
