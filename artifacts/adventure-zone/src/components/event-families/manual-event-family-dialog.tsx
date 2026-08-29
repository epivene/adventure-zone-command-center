import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { ProfileMemberPicker } from "@/components/event-families/profile-member-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/avz-crm/components/ui/dialog";
import { apiGet, apiPost } from "@/lib/auth-token";

type EventFamilyListItem = {
  id: string;
  name: string;
  memberCount?: number;
};

type Mode = "existing" | "new";

export function ManualEventFamilyDialog({
  open,
  onOpenChange,
  seedProfileId,
  onChanged,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  seedProfileId?: string | null;
  onChanged?: () => void | Promise<void>;
}) {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<Mode>(seedProfileId ? "existing" : "new");
  const [families, setFamilies] = useState<EventFamilyListItem[]>([]);
  const [familyId, setFamilyId] = useState("");
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loadingFamilies, setLoadingFamilies] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(seedProfileId ? "existing" : "new");
    setFamilyId("");
    setName("");
    setSelectedIds([]);
    setError(null);
    if (!seedProfileId) return;
    setLoadingFamilies(true);
    void apiGet<{ families: EventFamilyListItem[] }>("/event-families")
      .then((result) => setFamilies(result.families ?? []))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load event families."))
      .finally(() => setLoadingFamilies(false));
  }, [open, seedProfileId]);

  const creationIds = useMemo(() => {
    const ids = new Set(selectedIds);
    if (seedProfileId) ids.add(seedProfileId);
    return [...ids];
  }, [selectedIds, seedProfileId]);

  async function addToExisting() {
    if (!seedProfileId || !familyId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost<{ ok: true }>(`/event-families/${familyId}/members`, { organizationId: seedProfileId });
      await onChanged?.();
      onOpenChange(false);
      setLocation(`/event-families/${familyId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this profile to the event family.");
    } finally {
      setSaving(false);
    }
  }

  async function createFamily() {
    if (saving) return;
    const familyName = name.trim();
    if (!familyName) {
      setError("Add an event family name.");
      return;
    }
    if (creationIds.length < 2) {
      setError("Choose at least one more profile so the family has at least 2 profiles.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiPost<{ ok: true; familyId: string }>("/event-families", {
        name: familyName,
        organizationIds: creationIds,
      });
      await onChanged?.();
      onOpenChange(false);
      setLocation(`/event-families/${result.familyId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the event family.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white text-slate-950 shadow-2xl sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle>{seedProfileId ? "Add to Event Family" : "Create Event Family"}</DialogTitle>
          <DialogDescription className="text-slate-600">
            Event families group related event profiles, like the same festival or holiday event in multiple cities.
          </DialogDescription>
        </DialogHeader>

        {seedProfileId ? (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
            <button className={mode === "existing" ? "rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-950 shadow-sm" : "rounded-lg px-3 py-2 text-sm font-semibold text-slate-600"} onClick={() => { setMode("existing"); setError(null); }} type="button">Add to existing family</button>
            <button className={mode === "new" ? "rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-950 shadow-sm" : "rounded-lg px-3 py-2 text-sm font-semibold text-slate-600"} onClick={() => { setMode("new"); setError(null); }} type="button">Create new family</button>
          </div>
        ) : null}

        {mode === "existing" && seedProfileId ? (
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Event family
              <select className="bg-white text-slate-950" disabled={loadingFamilies || saving} onChange={(event) => setFamilyId(event.currentTarget.value)} value={familyId}>
                <option value="">Choose a family…</option>
                {families.map((family) => <option key={family.id} value={family.id}>{family.name}{typeof family.memberCount === "number" ? ` (${family.memberCount})` : ""}</option>)}
              </select>
            </label>
            {!loadingFamilies && families.length === 0 ? <p className="text-sm text-slate-500">No event families yet. Create a new family instead.</p> : null}
            <div className="-mx-6 -mb-6 mt-2 flex justify-end border-t border-slate-200 bg-white px-6 py-4" data-testid="event-family-dialog-footer">
              <button className="button-primary" disabled={!familyId || saving || loadingFamilies} onClick={() => void addToExisting()} type="button">
                {saving ? "Adding…" : "Add to family"}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Family name
              <input className="bg-white text-slate-950" maxLength={160} onChange={(event) => setName(event.currentTarget.value)} placeholder="Example: Water Lantern Festival" value={name} />
            </label>

            {seedProfileId ? <p className="text-sm text-slate-600">This profile is already selected. Search for at least one more related profile.</p> : <p className="text-sm text-slate-600">Choose at least 2 related profiles.</p>}

            {selectedIds.length ? <p className="text-sm font-semibold text-orange-700">{selectedIds.length} additional profile{selectedIds.length === 1 ? "" : "s"} selected</p> : null}

            <ProfileMemberPicker
              familyId=""
              disabled={saving}
              onSelectMany={(ids) => setSelectedIds((current) => [...new Set([...current, ...ids])])}
            />

            {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}

            <div className="-mx-6 -mb-6 mt-2 flex justify-end border-t border-slate-200 bg-white px-6 py-4" data-testid="event-family-dialog-footer">
              <button className="button-primary" disabled={saving || !name.trim() || creationIds.length < 2} onClick={() => void createFamily()} type="button">
                {saving ? "Creating…" : "Create event family"}
              </button>
            </div>
          </div>
        )}

        {mode === "existing" && error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
