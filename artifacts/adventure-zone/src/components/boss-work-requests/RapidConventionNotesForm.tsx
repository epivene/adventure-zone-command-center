import { useState } from "react";
import { Check, CloudOff, Loader2, Pencil } from "lucide-react";
import { submitConventionNotes, updateConventionNotes } from "@/features/boss-work-requests/boss-work-request-api";
import type { BossWorkRequestDetail, ConventionNotes } from "@/features/boss-work-requests/boss-work-request-types";
import { useConventionDraft } from "@/features/boss-work-requests/use-convention-draft";

const packages = ["Adventure Zone", "Weekend Warriors", "Pirates Rebellions"];

export function RapidConventionNotesForm({ detail, reload }: { detail: BossWorkRequestDetail; reload: () => Promise<void> }) {
  const { payload, setPayload, reset, saveState } = useConventionDraft(
    detail.request.id,
    detail.draft?.payload ?? { eventName: "" },
    detail.draft?.clientRevision ?? 0,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const field = (key: keyof ConventionNotes, value: string) => setPayload((current) => ({ ...current, [key]: value }));
  const savedToday = detail.submissions.filter((submission) =>
    new Date(submission.createdAt).toDateString() === new Date().toDateString());

  async function save() {
    if (!payload.eventName.trim()) { setError("Add the event name first."); return; }
    setWorking(true); setError("");
    try {
      if (editingId) {
        await updateConventionNotes(detail.request.id, editingId, payload);
      } else {
        await submitConventionNotes(detail.request.id, crypto.randomUUID(), payload);
      }
      await reload();
      setEditingId(null);
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The notes were not saved.");
    } finally { setWorking(false); }
  }

  function edit(submission: BossWorkRequestDetail["submissions"][number]) {
    if (submission.appliedAt) return;
    setEditingId(submission.id);
    setPayload(submission.payload);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">{editingId ? "Edit saved notes" : "Quick conversation notes"}</h2>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {saveState === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saveState === "offline" && <CloudOff className="h-3.5 w-3.5 text-destructive" />}
            {saveState === "saved" && <Check className="h-3.5 w-3.5 text-emerald-600" />}
            {saveState === "offline" ? "Saved on this device" : saveState}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Get the useful parts fast. The form saves while you type.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Event name *
            <input className="min-h-12 rounded-lg border bg-background px-3 text-base" value={payload.eventName} onChange={(e) => field("eventName", e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Organization
            <input className="min-h-12 rounded-lg border bg-background px-3 text-base" value={payload.organizationName ?? ""} onChange={(e) => field("organizationName", e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Person
            <input className="min-h-12 rounded-lg border bg-background px-3 text-base" value={payload.contactName ?? ""} onChange={(e) => field("contactName", e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Email
            <input type="email" className="min-h-12 rounded-lg border bg-background px-3 text-base" value={payload.email ?? ""} onChange={(e) => field("email", e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Phone
            <input inputMode="tel" className="min-h-12 rounded-lg border bg-background px-3 text-base" value={payload.phone ?? ""} onChange={(e) => field("phone", e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">City
            <input className="min-h-12 rounded-lg border bg-background px-3 text-base" value={payload.city ?? ""} onChange={(e) => field("city", e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">State
            <input className="min-h-12 rounded-lg border bg-background px-3 text-base" value={payload.state ?? ""} onChange={(e) => field("state", e.target.value)} />
          </label>
          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="text-sm font-semibold">What interested them?</legend>
            <div className="flex flex-wrap gap-2">
              {packages.map((name) => {
                const selected = payload.packageInterest?.includes(name) ?? false;
                return <button type="button" key={name} onClick={() => setPayload((current) => ({
                  ...current,
                  packageInterest: selected
                    ? (current.packageInterest ?? []).filter((item) => item !== name)
                    : [...(current.packageInterest ?? []), name],
                }))} className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${selected ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>{name}</button>;
              })}
            </div>
          </fieldset>
          <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Personal detail to mention in the email
            <textarea rows={2} className="rounded-lg border bg-background p-3 text-base" value={payload.personalDetails ?? ""} onChange={(e) => field("personalDetails", e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Next step
            <textarea rows={2} className="rounded-lg border bg-background p-3 text-base" value={payload.nextStep ?? ""} onChange={(e) => field("nextStep", e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Anything else
            <textarea rows={3} className="rounded-lg border bg-background p-3 text-base" value={payload.notes ?? ""} onChange={(e) => field("notes", e.target.value)} />
          </label>
        </div>
        {error && <p className="mt-3 text-sm font-semibold text-destructive" role="alert">{error}</p>}
        <button type="button" disabled={working} onClick={() => void save()}
          className="mt-5 min-h-14 w-full rounded-xl bg-primary px-5 text-base font-bold text-primary-foreground disabled:opacity-60">
          {working ? "Saving…" : editingId ? "Update Saved Notes" : "Save & Start Next"}
        </button>
      </section>
      <aside className="rounded-xl border bg-card p-4">
        <h2 className="font-bold">Saved Today</h2>
        <p className="text-xs text-muted-foreground">You can reopen an entry until Desiree applies it.</p>
        <div className="mt-3 grid gap-2">
          {savedToday.length === 0 && <p className="rounded-lg bg-muted p-3 text-sm">Nothing saved yet.</p>}
          {savedToday.map((submission) => (
            <button type="button" key={submission.id} disabled={Boolean(submission.appliedAt)} onClick={() => edit(submission)}
              className="flex items-center justify-between rounded-lg border p-3 text-left disabled:opacity-60">
              <span><span className="block font-semibold">{submission.payload.eventName}</span><span className="text-xs text-muted-foreground">{submission.payload.contactName || submission.payload.organizationName || "Conversation notes"}</span></span>
              {submission.appliedAt ? <Check className="h-4 w-4 text-emerald-600" /> : <Pencil className="h-4 w-4" />}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
