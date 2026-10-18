import { useCallback, useEffect, useRef, useState } from "react";

import { setLastResortAction } from "@/actions/organizations";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/avz-crm/components/ui/dialog";
import { apiGet } from "@/lib/auth-token";

export type ProfileLastResortState = {
  lastResort: boolean;
  lastResortReason: string | null;
};

async function loadLastResortState(profileId: string): Promise<ProfileLastResortState> {
  const profile = await apiGet<any>(`/event-profiles/${profileId}`);
  const place = profile?.place ?? profile?.organization ?? profile ?? {};
  return {
    lastResort: Boolean(place.lastResort),
    lastResortReason: typeof place.lastResortReason === "string" ? place.lastResortReason : null,
  };
}

export function useProfileLastResortState(profileId: string, supplied?: ProfileLastResortState) {
  const [state, setState] = useState<ProfileLastResortState | null>(supplied ?? null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const next = await loadLastResortState(profileId);
    if (request === generation.current) setState(next);
    return next;
  }, [profileId]);
  const suppliedLastResort = supplied?.lastResort;
  const suppliedReason = supplied?.lastResortReason;
  useEffect(() => {
    ++generation.current;
    if (suppliedLastResort !== undefined) {
      setState({ lastResort: suppliedLastResort, lastResortReason: suppliedReason ?? null });
    } else {
      setState(null);
      void refresh().catch(() => undefined);
    }
    return () => { ++generation.current; };
  }, [refresh, suppliedLastResort, suppliedReason]);
  return { state, refresh };
}

export function ProfileLastResortDialog({
  profileId,
  open,
  onOpenChange,
  onChanged,
}: {
  profileId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onChanged?: () => void | Promise<void>;
}) {
  const [state, setState] = useState<ProfileLastResortState | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    setConfirmed(false);
    void loadLastResortState(profileId)
      .then((next) => {
        if (!active) return;
        setState(next);
        setReason(next.lastResortReason ?? "");
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load Last Resort status.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [open, profileId]);

  const isLastResort = state?.lastResort === true;

  async function save() {
    if (!state || saving) return;
    const normalizedReason = reason.trim();
    if (!isLastResort && !normalizedReason) {
      setError("Add a Last Resort reason.");
      return;
    }
    if (!confirmed) {
      setError(isLastResort ? "Confirm before removing Last Resort." : "Confirm before marking Last Resort.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await setLastResortAction({
        organizationId: profileId,
        enabled: !isLastResort,
        reason: isLastResort ? "" : normalizedReason,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await onChanged?.();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update Last Resort status.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isLastResort ? "Remove Last Resort" : "Mark Last Resort"}</DialogTitle>
          <DialogDescription>
            {isLastResort
              ? "This profile will return to normal follow-up."
              : "Last Resort profiles stay out of routine follow-up until you remove the status."}
          </DialogDescription>
        </DialogHeader>
        {loading ? <p className="text-sm text-slate-500">Loading status…</p> : null}
        {!loading && state ? (
          <div className="grid gap-4">
            {isLastResort ? (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">Current reason: {state.lastResortReason || "Not recorded"}</p>
            ) : (
              <label className="grid gap-1 text-sm font-semibold text-slate-700">Last Resort reason
                <textarea className="min-h-24 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" maxLength={2000} onChange={(event) => setReason(event.target.value)} value={reason} />
              </label>
            )}
            <label className="flex items-start gap-2 text-sm font-semibold text-slate-700">
              <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
              <span>{isLastResort ? "I confirm this profile should be removed from Last Resort." : "I confirm this profile should be marked Last Resort."}</span>
            </label>
            {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button className="button-secondary" disabled={saving} onClick={() => onOpenChange(false)} type="button">Cancel</button>
              <button className={isLastResort ? "button-secondary" : "button-primary"} disabled={saving} onClick={() => void save()} type="button">
                {saving ? "Saving…" : isLastResort ? "Remove Last Resort" : "Mark Last Resort"}
              </button>
            </div>
          </div>
        ) : null}
        {!loading && error && !state ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

export function ProfileLastResortButton({ profileId }: { profileId: string }) {
  const [open, setOpen] = useState(false);
  const { state, refresh } = useProfileLastResortState(profileId);
  const label = state?.lastResort ? "Remove Last Resort" : "Mark Last Resort";
  return (
    <>
      <button className="button-secondary" onClick={() => setOpen(true)} type="button">{label}</button>
      <ProfileLastResortDialog onChanged={async () => { await refresh(); }} onOpenChange={setOpen} open={open} profileId={profileId} />
    </>
  );
}
