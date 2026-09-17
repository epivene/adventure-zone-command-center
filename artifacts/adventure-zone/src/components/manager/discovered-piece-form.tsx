import { useState } from "react";

export type LegInspectionResource = { id: string; name: string };
export type DiscoveredPieceDraft = {
  code: string | null;
  name: string | null;
  identityNotes: string | null;
  resourceId: string | null;
};

export function DiscoveredPieceForm({
  resources,
  disabled = false,
  onAdd,
}: {
  resources: LegInspectionResource[];
  disabled?: boolean;
  onAdd: (draft: DiscoveredPieceDraft) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [identityNotes, setIdentityNotes] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onAdd({
        code: code.trim() || null,
        name: name.trim() || null,
        identityNotes: identityNotes.trim() || null,
        resourceId: resourceId || null,
      });
      setCode("");
      setName("");
      setIdentityNotes("");
      setResourceId("");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return <button
      type="button"
      className="button-primary min-h-12 w-full"
      disabled={disabled}
      onClick={() => setOpen(true)}
    >Add &amp; Inspect an Attraction</button>;
  }

  return <section className="grid gap-3 rounded-xl border-2 border-orange-300 bg-orange-50 p-4">
    <div>
      <h2 className="font-bold">Add the attraction in front of you</h2>
      <p className="mt-1 text-sm text-slate-700">It will be added to this leg’s inspection now.</p>
    </div>
    <label className="grid gap-1 text-sm font-semibold">Attraction name or label
      <input aria-label="Attraction name or label" className="min-h-11 rounded-lg border px-3" value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: Purple and Blue Castle" />
    </label>
    <label className="grid gap-1 text-sm font-semibold">Existing code or number (optional)
      <input aria-label="Existing code or number" className="min-h-11 rounded-lg border px-3" value={code} onChange={(event) => setCode(event.target.value)} placeholder="A temporary code is created if blank" />
    </label>
    <label className="grid gap-1 text-sm font-semibold">Leg record
      <select aria-label="Leg record" className="min-h-11 rounded-lg border px-3" value={resourceId} onChange={(event) => setResourceId(event.target.value)}>
        <option value="">Not linked to a leg record</option>
        {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-sm font-semibold">Identification notes
      <textarea aria-label="Identification notes" className="min-h-24 rounded-lg border p-2" value={identityNotes} onChange={(event) => setIdentityNotes(event.target.value)} placeholder="Colors, markings, where it was stored, or anything that helps identify it" />
    </label>
    <div className="grid grid-cols-2 gap-2">
      <button type="button" className="min-h-11 rounded-lg border bg-white font-semibold" disabled={saving} onClick={() => setOpen(false)}>Cancel</button>
      <button type="button" className="button-primary min-h-11" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save & inspect this attraction"}</button>
    </div>
  </section>;
}
