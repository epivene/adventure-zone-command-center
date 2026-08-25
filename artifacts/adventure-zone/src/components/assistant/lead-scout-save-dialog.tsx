import { useState, type FormEvent } from "react";

import type { LeadScoutCandidate } from "@/features/assistant/assistant-types";
import type {
  LeadScoutSaveResult,
  LeadScoutSaveSubmission,
} from "@/features/assistant/lead-scout-api";

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

export function LeadScoutSaveDialog({
  candidate,
  onClose,
  onSave,
}: {
  candidate: LeadScoutCandidate;
  onClose(): void;
  onSave(input: LeadScoutSaveSubmission): Promise<LeadScoutSaveResult>;
}) {
  const [name, setName] = useState(candidate.name);
  const [city, setCity] = useState(candidate.city ?? "");
  const [region, setRegion] = useState(candidate.region ?? "");
  const [startsAt, setStartsAt] = useState(candidate.startsAt ?? "");
  const [endsAt, setEndsAt] = useState(candidate.endsAt ?? "");
  const [website, setWebsite] = useState(candidate.website ?? "");
  const [contactName, setContactName] = useState(candidate.organizerName ?? "");
  const [contactEmail, setContactEmail] = useState(candidate.organizerEmail ?? "");
  const [contactPhone, setContactPhone] = useState(candidate.organizerPhone ?? "");
  const [nextActionKind, setNextActionKind] = useState<"" | LeadScoutSaveSubmission["nextActionKind"]>("");
  const [nextActionDueAt, setNextActionDueAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Extract<LeadScoutSaveResult, { kind: "duplicate" }> | null>(null);

  const canSave = Boolean(
    name.trim() &&
    city.trim() &&
    region.trim().length === 2 &&
    website.trim() &&
    nextActionKind &&
    nextActionDueAt,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave || !nextActionKind || saving) return;
    setSaving(true);
    setError(null);
    setDuplicate(null);
    try {
      const result = await onSave({
        accepted: {
          name: name.trim(),
          city: city.trim(),
          region: region.trim().toUpperCase(),
          startsAt: nullable(startsAt),
          endsAt: nullable(endsAt),
          website: website.trim(),
          contactName: nullable(contactName),
          contactEmail: nullable(contactEmail),
          contactPhone: nullable(contactPhone),
        },
        nextActionKind,
        nextActionDueAt,
      });
      if (result.kind === "duplicate") {
        setDuplicate(result);
        return;
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create this profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/40 p-4" role="presentation">
      <form
        aria-label="Create Scout profile"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        onSubmit={submit}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-950">Scout Profile Draft</h3>
            <p className="mt-1 text-sm text-slate-600">Review the event details before creating a real Command Center profile. Scout Notes and research sources will be saved with it.</p>
          </div>
          <button className="button-secondary" onClick={onClose} type="button">Cancel</button>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Profile name
            <input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" onChange={(event) => setName(event.currentTarget.value)} value={name} />
          </label>
          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              City
              <input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" onChange={(event) => setCity(event.currentTarget.value)} value={city} />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              State
              <input className="rounded-lg border border-slate-300 px-3 py-2 font-normal uppercase" maxLength={2} onChange={(event) => setRegion(event.currentTarget.value)} value={region} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Start date
              <input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" onChange={(event) => setStartsAt(event.currentTarget.value)} type="date" value={startsAt} />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              End date
              <input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" onChange={(event) => setEndsAt(event.currentTarget.value)} type="date" value={endsAt} />
            </label>
          </div>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Website
            <input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" onChange={(event) => setWebsite(event.currentTarget.value)} type="url" value={website} />
          </label>

          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm font-bold text-slate-900">Organizer contact</p>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                Contact name
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" onChange={(event) => setContactName(event.currentTarget.value)} value={contactName} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                Contact email
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" onChange={(event) => setContactEmail(event.currentTarget.value)} type="email" value={contactEmail} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                Contact phone
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" onChange={(event) => setContactPhone(event.currentTarget.value)} type="tel" value={contactPhone} />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
            <p className="text-sm font-bold text-slate-950">First step after saving</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                First action
                <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" onChange={(event) => setNextActionKind(event.currentTarget.value as typeof nextActionKind)} value={nextActionKind}>
                  <option value="">Choose…</option>
                  <option value="call">Call</option>
                  <option value="email">Email</option>
                  <option value="prepare_quote">Prepare quote</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                First follow-up date
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" onChange={(event) => setNextActionDueAt(event.currentTarget.value)} type="date" value={nextActionDueAt} />
              </label>
            </div>
          </div>
        </div>

        {duplicate ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-bold">A possible match already exists in Command Center.</p>
            <p className="mt-1">I did not create another profile.</p>
            <a className="mt-2 inline-block font-semibold text-orange-700 hover:underline" href={`/profiles/${duplicate.match.organizationId}`}>Review existing profile</a>
          </div>
        ) : null}
        {error ? <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button className="button-secondary" onClick={onClose} type="button">Cancel</button>
          <button className="button-primary" disabled={!canSave || saving} type="submit">{saving ? "Creating…" : "Create Profile"}</button>
        </div>
      </form>
    </div>
  );
}
