export type CalendarProfileResult = { profileId: string; profileName: string; city?: string | null; region?: string | null; matchNote?: string };
export function OperationalCalendarProfileResults({ profiles }: { profiles: CalendarProfileResult[] }) {
  if (!profiles.length) return null;
  return <div className="mt-3 grid gap-2" aria-label="Existing profile matches">
    <p className="text-sm font-bold">Existing profiles found</p>
    {profiles.map(profile => <div key={profile.profileId} className="rounded-lg border border-primary/30 bg-card p-3">
      <a className="font-semibold underline" href={`/profiles/${profile.profileId}`} target="_blank" rel="noreferrer">{profile.profileName}</a>
      <p className="text-sm">{[profile.city, profile.region].filter(Boolean).join(", ") || "Location not set"}</p>
      {profile.matchNote && <p className="text-xs">{profile.matchNote}</p>}
      <p className="mt-1 text-xs">Open this existing profile to choose or add the correct booking, then return here to link it. You do not need another profile.</p>
    </div>)}
  </div>;
}
