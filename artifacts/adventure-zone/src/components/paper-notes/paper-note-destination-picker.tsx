import type {
  PaperNoteMatch,
  PaperNoteReviewDraft,
} from "@/features/paper-notes/paper-note-review-types";

export function PaperNoteDestinationPicker({
  review,
  matches,
  onChooseExisting,
  onChooseNewLocation,
  onChooseNewProfile,
}: {
  review: PaperNoteReviewDraft;
  matches: PaperNoteMatch[];
  onChooseExisting(match: PaperNoteMatch): void;
  onChooseNewLocation(match: PaperNoteMatch): void;
  onChooseNewProfile(): void;
}) {
  const destination = review.destination;

  return (
    <section className="mt-6 border-t border-slate-200 pt-5">
      <h3 className="font-bold text-slate-900">Where this entry belongs</h3>
      <p className="mt-1 text-sm text-slate-600">Suggestions are evidence only. You choose the destination.</p>

      <div className="mt-3 grid gap-2">
        {matches.map((match) => (
          <div
            className="rounded-xl border border-slate-200 p-3"
            key={`${match.organizationId}:${match.organizationLocationId ?? "profile"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-900">{match.name}</p>
                <p className="text-sm text-slate-500">
                  {[match.city, match.region].filter(Boolean).join(", ") || "Location not saved"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {match.reasons.map((reason) => (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700" key={reason}>
                      {reason}
                    </span>
                  ))}
                </div>
                {match.contacts.length ? (
                  <p className="mt-2 text-xs text-slate-500">
                    {match.contacts.length} saved contact{match.contacts.length === 1 ? "" : "s"} available to link
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  aria-label={`Use ${match.name}`}
                  className="min-h-11 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-bold text-orange-900"
                  onClick={() => onChooseExisting(match)}
                  type="button"
                >
                  Use this profile
                </button>
                <button
                  aria-label={`Create new location under ${match.name}`}
                  className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                  onClick={() => onChooseNewLocation(match)}
                  type="button"
                >
                  New location here
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          aria-label="Create new profile"
          className="min-h-11 rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white"
          onClick={onChooseNewProfile}
          type="button"
        >
          Create new profile
        </button>
      </div>

      {destination?.mode === "existing_profile_new_location" ? (
        <div className="mt-4 grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-950">New location under existing profile</p>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            New location label
            <input
              aria-label="New location label"
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
              readOnly
              value={destination.newLocation.label}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              New location city
              <input
                aria-label="New location city"
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
                readOnly
                value={destination.newLocation.city ?? ""}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              New location state
              <input
                aria-label="New location state"
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal uppercase"
                readOnly
                value={destination.newLocation.region ?? ""}
              />
            </label>
          </div>
        </div>
      ) : null}
    </section>
  );
}
