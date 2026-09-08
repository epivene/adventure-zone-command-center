import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

import { ContractArrangementFields } from "@/components/contracts/contract-arrangement-fields";
import { ContractEventFields } from "@/components/contracts/contract-event-fields";
import { ContractOperationalFields } from "@/components/contracts/contract-operational-fields";
import { ContractPreview } from "@/components/contracts/contract-preview";
import { contractClient } from "@/features/contracts/contract-client";
import { editableContractValues } from "@/features/contracts/contract-form-values";
import type { ContractDraft, ContractValues } from "@/features/contracts/contract-types";

export default function ContractBuilderPage({ draftId, autosaveDelayMs = 600 }: { draftId: string; autosaveDelayMs?: number }) {
  const [, setLocation] = useLocation();
  const [draft, setDraft] = useState<ContractDraft | null>(null);
  const [values, setValues] = useState<ContractValues | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    contractClient.getDraft(draftId).then(({ draft: loadedDraft }) => {
      if (cancelled) return;
      if (!loadedDraft?.storedValues?.contract || !loadedDraft.validationState) {
        throw new Error("Could not load this contract draft. Please return to the profile and try again.");
      }
      setDraft(loadedDraft);
      setValues(editableContractValues(loadedDraft.storedValues.contract));
      loaded.current = true;
    }).catch((reason: Error) => {
      if (!cancelled) setError(reason.message || "Could not load this contract draft.");
    });
    return () => { cancelled = true; };
  }, [draftId]);

  useEffect(() => {
    if (!loaded.current || !draft || !values || saveState !== "saving") return;
    const timer = window.setTimeout(() => {
      contractClient.saveDraft(draft.id, draft.revision, values).then(({ draft: saved }) => {
        if (!saved?.storedValues?.contract || !saved.validationState) throw new Error("The contract was saved, but the returned draft was incomplete. Please refresh.");
        setDraft(saved);
        setValues(editableContractValues(saved.storedValues.contract));
        setError(null);
        setSaveState("saved");
      }).catch((reason: Error) => {
        const conflict = (reason as Error & { status?: number }).status === 409;
        setError(conflict ? "This contract changed in another session. Refresh before saving again." : reason.message);
        setSaveState("error");
      });
    }, autosaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [autosaveDelayMs, draft, saveState, values]);

  function change(next: ContractValues) {
    setValues(next);
    setSaveState("saving");
    setError(null);
  }

  async function generate() {
    if (!draft?.validationState.ready || generating) return;
    setGenerating(true);
    try {
      const result = await contractClient.finalizeDraft(draft.id);
      setLocation(`/contracts/${result.version.id}/handoff`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not generate the contract.");
      setGenerating(false);
    }
  }

  if (error && !draft) return <p className="mx-auto max-w-2xl text-rose-700" role="alert">{error}</p>;
  if (!draft || !values) return <p className="mx-auto max-w-2xl text-slate-600">Loading contract…</p>;

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-4 pb-28">
      <header>
        <p className="text-sm font-bold uppercase tracking-wider text-sky-700">Contract builder</p>
        <h1 className="text-3xl font-bold">Build contract</h1>
        <p className="mt-1 text-sm text-slate-600">Review every detail before generating the PDF. Dave adds his stored signature only inside Adobe.</p>
      </header>

      {draft.validationState.errors.length ? <section className="rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label="Missing contract details">
        <h2 className="font-bold">Still needed</h2>
        {draft.validationState.errors.map((item) => <p className="mt-1 text-sm" key={`${item.path}-${item.message}`}>{item.message}</p>)}
      </section> : null}

      <ContractEventFields values={values} onChange={change} />

      <ContractArrangementFields values={values} onChange={change} />
      <ContractOperationalFields values={values} onChange={change} />

      <section className="grid gap-3 rounded-xl border bg-white p-4">
        <h2 className="text-lg font-bold">Certificate of insurance</h2>
        <p className="text-sm text-slate-600">After the signed agreement is confirmed, an editable Gmail draft will be prepared for Sara Toone at sara@protectiveins.net.</p>
        <label className="grid gap-1 text-sm font-semibold">Certificate holder
          <input value={values.coi.certificateHolderName} onChange={(event) => change({ ...values, coi: { ...values.coi, certificateHolderName: event.target.value } })} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">Certificate holder address
          <textarea value={values.coi.certificateHolderAddress} onChange={(event) => change({ ...values, coi: { ...values.coi, certificateHolderAddress: event.target.value } })} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">Additional insured wording
          <textarea value={values.coi.additionalInsuredWording} onChange={(event) => change({ ...values, coi: { ...values.coi, additionalInsuredWording: event.target.value } })} />
        </label>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="text-lg font-bold">Signing order</h2>
        <p className="mt-2 text-sm">1. {values.eventSigner.name} — {values.eventSigner.email}</p>
        <p className="mt-1 text-sm">2. {values.internalSigner.name} — {values.internalSigner.email}</p>
      </section>

      <button className="button-secondary min-h-11" onClick={() => setPreview((current) => !current)} type="button">{preview ? "Hide preview" : "Preview contract"}</button>
      {preview ? <ContractPreview values={values} /> : null}
      {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}

      <div className="sticky bottom-3 grid gap-2 rounded-xl border bg-white/95 p-3 shadow-lg backdrop-blur">
        <p className="text-center text-sm font-semibold" aria-live="polite">{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed — review the message above" : "Review your contract details"}</p>
        <button className="button-primary min-h-12" disabled={!draft.validationState.ready || saveState === "saving" || generating} onClick={() => void generate()} type="button">{generating ? "Generating…" : "Generate contract"}</button>
      </div>
    </main>
  );
}
