import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import { contractClient } from "@/features/contracts/contract-client";

type FormState = {
  internalSignerName: string;
  internalSignerEmail: string;
  insuranceRecipientName: string;
  insuranceRecipientEmail: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SettingsContractsPage() {
  const [form, setForm] = useState<FormState | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    contractClient.getSettings().then((settings) => {
      if (!settings.enabled) throw new Error("Contract builder is not enabled.");
      setForm({
        internalSignerName: settings.internalSignerName ?? "Dave Gordon",
        internalSignerEmail: settings.internalSignerEmail ?? "",
        insuranceRecipientName: settings.insuranceRecipientName ?? "Sara Toone",
        insuranceRecipientEmail: settings.insuranceRecipientEmail ?? "sara@protectiveins.net",
      });
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    if (!emailPattern.test(form.internalSignerEmail) || !emailPattern.test(form.insuranceRecipientEmail)) {
      setError("Enter a valid email address for Dave and Sara.");
      return;
    }
    setState("saving");
    setError(null);
    try {
      await contractClient.updateSettings(form);
      setState("saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save contract settings.");
      setState("idle");
    }
  }

  if (error && !form) return <p className="text-rose-700" role="alert">{error}</p>;
  if (!form) return <p className="text-slate-600">Loading contract settings…</p>;
  const field = (key: keyof FormState) => (event: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  return (
    <main className="mx-auto grid w-full max-w-2xl gap-4">
      <header>
        <p className="text-sm font-bold uppercase tracking-wider text-sky-700">Admin tools</p>
        <h1 className="text-3xl font-bold">Contracts & signing</h1>
        <p className="mt-2 text-sm text-slate-600">Changes affect future contract drafts only. Existing drafts, finalized contracts, and PDF versions keep their saved snapshots.</p>
      </header>
      <form aria-label="Contract settings" className="grid gap-4 rounded-xl border bg-white p-5" onSubmit={(event) => void submit(event)}>
        <h2 className="text-lg font-bold">Adventure Zone signer</h2>
        <label className="grid gap-1 text-sm font-semibold">Signer name
          <input value={form.internalSignerName} onChange={field("internalSignerName")} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">Dave's signing email
          <input aria-label="Dave's signing email" inputMode="email" value={form.internalSignerEmail} onChange={field("internalSignerEmail")} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">Signing order
          <input disabled value="2 — signs second" />
        </label>
        <p className="text-sm text-slate-600">Dave’s saved signature stays in Adobe. This system stores only his signer name, email, and order.</p>
        <h2 className="mt-2 text-lg font-bold">Insurance recipient</h2>
        <label className="grid gap-1 text-sm font-semibold">Recipient name
          <input value={form.insuranceRecipientName} onChange={field("insuranceRecipientName")} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">Recipient email
          <input inputMode="email" value={form.insuranceRecipientEmail} onChange={field("insuranceRecipientEmail")} />
        </label>
        {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
        {state === "saved" ? <p className="text-sm font-semibold text-emerald-700">Settings saved</p> : null}
        <button className="button-primary min-h-11" disabled={state === "saving"} type="submit">{state === "saving" ? "Saving…" : "Save settings"}</button>
      </form>
    </main>
  );
}
