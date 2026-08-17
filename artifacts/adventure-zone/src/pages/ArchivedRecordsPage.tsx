import { useEffect, useState } from "react";

import { getArchivedProfiles, restoreProfile } from "@/actions/profile-lifecycle";
import type { ArchivedProfileSummary } from "@/features/record-lifecycle/profile-lifecycle-types";

function formatArchivedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Archived date unavailable";
  return `Archived ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date)}`;
}

export default function ArchivedRecordsPage() {
  const [profiles, setProfiles] = useState<ArchivedProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    getArchivedProfiles()
      .then((records) => {
        setProfiles(records);
        setPageError(null);
      })
      .catch((error: unknown) => {
        setPageError(error instanceof Error ? error.message : "Could not load archived records.");
      })
      .finally(() => setLoading(false));
  }, []);

  async function restore(profile: ArchivedProfileSummary) {
    if (!window.confirm("Restore this profile to normal lists and searches?")) return;
    setBusyId(profile.id);
    setErrorById((current) => ({ ...current, [profile.id]: "" }));
    try {
      await restoreProfile(profile.id);
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
    } catch (error) {
      setErrorById((current) => ({
        ...current,
        [profile.id]: error instanceof Error ? error.message : "Could not restore this profile.",
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-950">Archived records</h1>
        <p className="mt-1 text-sm text-slate-600">
          Archived profiles stay out of normal lists and searches. Their contacts, bookings, notes, history, and relationships are preserved.
        </p>
      </header>

      {pageError ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">{pageError}</p> : null}
      {loading ? <p className="text-sm text-slate-500">Loading archived records…</p> : null}

      {!loading && !pageError && profiles.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          No archived profiles.
        </div>
      ) : null}

      <div className="grid gap-3">
        {profiles.map((profile) => {
          const location = [profile.city, profile.region].filter(Boolean).join(", ");
          return (
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={profile.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-bold text-slate-950">{profile.name}</h2>
                  {location ? <p className="mt-1 text-sm text-slate-600">{location}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">{formatArchivedAt(profile.archivedAt)}</p>
                </div>
                <button
                  className="button-secondary min-h-11 shrink-0"
                  disabled={busyId !== null}
                  onClick={() => void restore(profile)}
                  type="button"
                >
                  {busyId === profile.id ? "Restoring…" : "Restore"}
                </button>
              </div>
              {errorById[profile.id] ? <p className="mt-3 text-sm text-rose-700" role="alert">{errorById[profile.id]}</p> : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
