import { useCallback, useEffect, useState } from "react";

import { setFillerAction } from "@/actions/organizations";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/avz-crm/components/ui/dialog";
import { apiGet } from "@/lib/auth-token";

export type ProfileFillerState = {
  filler: boolean;
  reason: string | null;
  changedAt: string | null;
};

async function loadFillerState(profileId: string): Promise<ProfileFillerState> {
  return apiGet<ProfileFillerState>(`/organizations/filler?organizationId=${encodeURIComponent(profileId)}`);
}

export function useProfileFillerState(profileId: string) {
  const [state, setState] = useState<ProfileFillerState | null>(null);
  const refresh = useCallback(async () => {
    const next = await loadFillerState(profileId);
    setState(next);
    return next;
  }, [profileId]);
  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);
  return { state, refresh };
}

export function ProfileFillerBadge({ profileId }: { profileId: string }) {
  const { state } = useProfileFillerState(profileId);
  if (!state?.filler) return null;
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800" title={state.reason ?? undefined}>Filler</span>;
}

export function ProfileFillerDialog({ profileId, open, onOpenChange, onChanged }: {
  profileId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onChanged?: () => void | Promise<void>;
}) {
  const [state, setState] = useState<ProfileFillerState | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    void loadFillerState(profileId)
      .then((next) => {
        if (!active) return;
        setState(next);
        setReason(next.reason ?? "");
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load Filler status."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, profileId]);

  const isFiller = state?.filler === true;

  async function save() {
    if (!state || saving) return;
    const normalizedReason = reason.trim();
    if (!isFiller && !normalizedReason) {
      setError("Add a Filler reason.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await setFillerAction({ organizationId: profileId, enabled: !isFiller, reason: isFiller ? "" : normalizedReason });
      if (!result.ok) { setError(result.error); return; }
      await onChanged?.();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update Filler strategy.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isFiller ? "Remove Filler" : "Mark Filler"}</DialogTitle>
          <DialogDescription>
            {isFiller
              ? "This profile will return to normal prospect priority."
              : "Use Filler for lower-priority events that become useful when they fill a route gap, an open weekend, or a space between bookings."}
          </DialogDescription>
        </DialogHeader>
        {loading ? <p className="text-sm text-slate-500">Loading strategy…</p> : null}
        {!loading && state ? (
          <div className="grid gap-4">
            {isFiller ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Current Filler reason: {state.reason || "Not recorded"}</p> : (
              <label className="grid gap-1 text-sm font-semibold text-slate-700">Filler reason
                <textarea
                  className="min-h-24 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
                  maxLength={2000}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Example: route gap, open weekend, or between bookings"
                  value={reason}
                />
              </label>
            )}
            {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button className="button-secondary" disabled={saving} onClick={() => onOpenChange(false)} type="button">Cancel</button>
              <button className={isFiller ? "button-secondary" : "button-primary"} disabled={saving} onClick={() => void save()} type="button">
                {saving ? "Saving…" : isFiller ? "Remove Filler" : "Mark Filler"}
              </button>
            </div>
          </div>
        ) : null}
        {!loading && error && !state ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
