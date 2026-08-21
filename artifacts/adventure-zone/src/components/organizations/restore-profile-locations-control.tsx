import { useEffect, useState } from "react";
import { Link } from "wouter";

import { apiGet, apiPost } from "@/lib/auth-token";

type RestorableProfileLocation = {
  locationId: string;
  sourceProfileId: string;
  sourceProfileName: string;
  label: string;
  city: string | null;
  region: string | null;
};

type RestoreResult = {
  ok: true;
  restoredLocationCount: number;
  restoredProfileIds: string[];
};

export function RestoreProfileLocationsControl({
  orgId,
  onRestored,
}: {
  orgId: string;
  onRestored?: () => void;
}) {
  const [profiles, setProfiles] = useState<RestorableProfileLocation[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState<RestorableProfileLocation[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiGet<{ profiles: RestorableProfileLocation[] }>(
      `/organizations/${orgId}/locations/restorable-profiles`,
    )
      .then((result) => {
        if (!cancelled) setProfiles(result.profiles ?? []);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not check merged profiles.");
      });
    return () => { cancelled = true; };
  }, [orgId]);

  async function restore() {
    if (!profiles?.length || restoring) return;
    setRestoring(true);
    setError(null);
    try {
      const before = profiles;
      const result = await apiPost<RestoreResult>(
        `/organizations/${orgId}/locations/restore-profiles`,
        {},
      );
      const restoredIds = new Set(result.restoredProfileIds);
      setRestored(before.filter((profile) => restoredIds.has(profile.sourceProfileId)));
      setProfiles([]);
      setConfirming(false);
      onRestored?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not restore the separate profiles.");
    } finally {
      setRestoring(false);
    }
  }

  if (restored.length) {
    return (
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="font-semibold text-emerald-950">
          Restored {restored.length} separate profiles. They’re ready to add to an Event Family.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {restored.map((profile) => (
            <Link
              className="font-semibold text-emerald-800 underline"
              href={`/profiles/${profile.sourceProfileId}`}
              key={profile.sourceProfileId}
            >
              {profile.sourceProfileName}
            </Link>
          ))}
        </div>
      </section>
    );
  }

  if (profiles !== null && profiles.length === 0 && !error) return null;
  if (profiles === null && !error) return null;

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
      {profiles?.length ? (
        <>
          <p className="font-bold text-amber-950">
            {profiles.length} merged {profiles.length === 1 ? "profile can" : "profiles can"} be restored
          </p>
          <p className="mt-1 text-sm text-amber-900">
            These locations came from separate profiles that were retired when they were merged here.
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm text-amber-950">
            {profiles.map((profile) => (
              <li key={profile.locationId}>
                <span className="font-semibold">{profile.sourceProfileName}</span>
                {profile.city || profile.region
                  ? ` — ${[profile.city, profile.region].filter(Boolean).join(", ")}`
                  : ""}
              </li>
            ))}
          </ul>

          {!confirming ? (
            <button
              className="button-secondary mt-3"
              onClick={() => setConfirming(true)}
              type="button"
            >
              Restore separate profiles
            </button>
          ) : (
            <div className="mt-3 rounded-md border border-amber-300 bg-white p-3">
              <p className="text-sm font-semibold text-slate-900">
                This will turn these {profiles.length} locations back into separate profiles and move their contacts, bookings, notes/history, follow-ups, and call data back with them. Manually-created locations will not be changed.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="button-primary"
                  disabled={restoring}
                  onClick={() => { void restore(); }}
                  type="button"
                >
                  {restoring ? "Restoring…" : `Yes, restore ${profiles.length} profiles`}
                </button>
                <button
                  className="button-secondary"
                  disabled={restoring}
                  onClick={() => setConfirming(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
