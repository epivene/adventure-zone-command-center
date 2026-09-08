import { useEffect, useState } from "react";

import { contractClient } from "@/features/contracts/contract-client";
import type { ContractStatus, ContractVersion } from "@/features/contracts/contract-types";
import { SignedContractUpload } from "@/components/contracts/signed-contract-upload";
import { CoiNextAction } from "@/components/contracts/coi-next-action";

export const ADOBE_REQUEST_ESIGNATURES_URL = "https://www.adobe.com/acrobat/online/request-signature.html";

const statusLabel: Partial<Record<ContractStatus, string>> = {
  ready_for_adobe: "Ready for Adobe",
  sent_for_signature: "Sent for signature",
  partially_signed: "Partially signed",
  completed: "Completed",
};

export default function ContractHandoffPage({ contractVersionId }: { contractVersionId: string }) {
  const [version, setVersion] = useState<ContractVersion | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    contractClient.getVersion(contractVersionId).then((result) => { if (!cancelled) setVersion(result.version); })
      .catch((reason: Error) => setError(reason.message));
    return () => { cancelled = true; };
  }, [contractVersionId]);

  if (error && !version) return <p className="text-rose-700" role="alert">{error}</p>;
  if (!version) return <p className="text-slate-600">Loading contract handoff…</p>;
  const values = version.snapshot.values;
  const unsigned = version.files?.find((file) => file.kind === "unsigned_generated");
  const agreementName = `${values.eventName} Agreement`;

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
  }
  async function openPdf() {
    if (!unsigned) return;
    try {
      const result = await contractClient.openFile(version!.id, unsigned.id);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open the PDF."); }
  }
  async function markSent() {
    if (!confirmed || busy) return;
    setBusy(true);
    try {
      await contractClient.confirmAdobeSent(version!.id);
      setVersion({ ...version!, status: "sent_for_signature" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the contract.");
      setBusy(false);
    }
  }
  async function updateStatus(status: "partially_signed" | "declined" | "cancelled") {
    if (busy) return;
    setBusy(true);
    try {
      await contractClient.transition(version!.id, status);
      setVersion({ ...version!, status });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the contract.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-4">
      <header>
        <p className="text-sm font-bold uppercase tracking-wider text-sky-700">Manual Adobe handoff</p>
        <h1 className="text-3xl font-bold">Send through Adobe</h1>
        <p className="mt-2 inline-block rounded-full bg-slate-100 px-3 py-1 text-sm font-bold">{statusLabel[version.status] ?? version.status}</p>
      </header>

      <section className="grid gap-3 rounded-xl border bg-white p-4">
        <h2 className="text-lg font-bold">1. Open the generated PDF</h2>
        <p className="text-sm text-slate-600">This opens a five-minute private link. Download the PDF before moving to Adobe.</p>
        <button className="button-secondary min-h-11" disabled={!unsigned} onClick={() => void openPdf()} type="button">Open contract PDF</button>
      </section>

      <section className="grid gap-3 rounded-xl border bg-white p-4">
        <h2 className="text-lg font-bold">2. Copy the agreement details</h2>
        <p className="text-sm"><strong>{agreementName}</strong></p>
        <button className="button-secondary min-h-11" onClick={() => void copy(agreementName)} type="button">Copy agreement name</button>
        <p className="text-sm">1. {values.eventSigner.name}</p>
        <p className="text-sm text-slate-600">{values.eventSigner.email}</p>
        <button className="button-secondary min-h-11" onClick={() => void copy(values.eventSigner.email)} type="button">Copy signer 1 email</button>
        <p className="text-sm">2. {values.internalSigner.name}</p>
        <p className="text-sm text-slate-600">{values.internalSigner.email}</p>
        <button className="button-secondary min-h-11" onClick={() => void copy(values.internalSigner.email)} type="button">Copy signer 2 email</button>
      </section>

      <section className="grid gap-3 rounded-xl border bg-white p-4">
        <h2 className="text-lg font-bold">3. Finish in Adobe</h2>
        <a className="button-primary min-h-11 text-center" href={ADOBE_REQUEST_ESIGNATURES_URL} rel="noreferrer" target="_blank">Open Adobe Request e-signatures</a>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Upload the downloaded contract PDF.</li>
          <li>Turn on signing order: event representative first, Dave second.</li>
          <li>Place signature and date fields for both signers.</li>
          <li>Dave can select his saved signature when Adobe requests his signature second.</li>
        </ul>
      </section>

      {version.status === "ready_for_adobe" ? <section className="grid gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
        <label className="flex min-h-11 items-center gap-3 font-semibold">
          <input aria-label="I sent it through Adobe" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
          I sent it through Adobe
        </label>
        <button className="button-primary min-h-11" disabled={!confirmed || busy} onClick={() => void markSent()} type="button">Confirm sent through Adobe</button>
      </section> : null}
      {version.status === "sent_for_signature" || version.status === "partially_signed" ? <section className="grid gap-2 rounded-xl border bg-white p-4 sm:grid-cols-3">
        {version.status === "sent_for_signature" ? <button className="button-secondary min-h-11" disabled={busy} onClick={() => void updateStatus("partially_signed")} type="button">Mark partially signed</button> : null}
        <button className="button-secondary min-h-11" disabled={busy} onClick={() => void updateStatus("declined")} type="button">Mark declined</button>
        <button className="button-secondary min-h-11" disabled={busy} onClick={() => void updateStatus("cancelled")} type="button">Mark cancelled</button>
      </section> : null}
      {version.status === "sent_for_signature" || version.status === "partially_signed" ? <SignedContractUpload
        contractVersionId={version.id}
        versionNumber={version.versionNumber ?? 1}
        onCompleted={() => { void contractClient.getVersion(version.id).then((result) => setVersion(result.version)); }}
      /> : null}
      <CoiNextAction
        contractVersionId={version.id}
        coiDraft={version.coiDraft}
        onRefresh={() => { void contractClient.getVersion(version.id).then((result) => setVersion(result.version)); }}
      />
      {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
    </main>
  );
}
