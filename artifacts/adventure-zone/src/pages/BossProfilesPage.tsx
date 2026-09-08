import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { MapPin, Search, UserRound } from "lucide-react";
import { bossGet } from "@/lib/boss-auth-context";

type ProfileRecord = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  primaryContactName: string | null;
  profileImageDataUrl: string | null;
  contactCount: number;
  bookingCount: number;
  locationCount: number;
};
type Family = { id: string; name: string; description: string | null; memberCount: number; matchedMemberCount: number };
type Page = { records: ProfileRecord[]; families: Family[]; total: number; page: number; pageCount: number };

function ProfileAvatar({ profile }: { profile: ProfileRecord }) {
  return profile.profileImageDataUrl
    ? <img alt={`${profile.name} profile`} className="h-full w-full object-cover" src={profile.profileImageDataUrl} />
    : <div className="flex h-full w-full items-center justify-center text-primary"><UserRound className="h-10 w-10" /></div>;
}

export default function BossProfilesPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const [query, setQuery] = useState(q);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (page > 1) qs.set("page", String(page));
    let active = true;
    bossGet<Page>(`/boss/profiles?${qs}`)
      .then((next) => { if (active) { setData(next); setError(""); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load profiles."); });
    return () => { active = false; };
  }, [q, page]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    setLocation(value ? `/boss/profiles?q=${encodeURIComponent(value)}` : "/boss/profiles");
  }

  function href(next: number) {
    const nextParams = new URLSearchParams();
    if (q) nextParams.set("q", q);
    if (next > 1) nextParams.set("page", String(next));
    return `/boss/profiles${nextParams.size ? `?${nextParams}` : ""}`;
  }

  return (
    <div className="grid gap-5" data-testid="boss-profiles-page">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss</p>
        <h1 className="mt-1 text-2xl font-bold">Profiles</h1>
        <p className="mt-1 text-sm text-muted-foreground">Event organizations, contacts, locations, bookings, and history.</p>
      </header>
      <form className="flex gap-2" onSubmit={submit}>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search profiles</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input aria-label="Search profiles" className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3" onChange={(event) => setQuery(event.target.value)} placeholder="Search profiles, contacts, or cities" value={query} />
        </label>
        <button className="button-secondary shrink-0" type="submit">Search</button>
      </form>
      {error ? <p className="rounded-xl bg-destructive/10 p-4 text-destructive" role="alert">{error}</p> : null}
      {data ? (
        <>
          {data.families.length ? (
            <details className="rounded-xl border border-border bg-card p-4">
              <summary className="cursor-pointer font-bold">Event Families ({data.families.length})</summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {data.families.map((family) => (
                  <div className="rounded-lg border border-border p-3" key={family.id}>
                    <p className="font-bold">{family.name}</p>
                    <p className="text-sm text-muted-foreground">{family.memberCount} linked profile{family.memberCount === 1 ? "" : "s"}</p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          <p className="text-sm text-muted-foreground">Showing {data.records.length} of {data.total} profiles</p>
          <div className="grid gap-2">
            {data.records.map((profile) => {
              const location = [profile.city, profile.region].filter(Boolean).join(", ");
              return (
                <Link className="rounded-xl border border-border bg-card p-3 shadow-sm transition hover:border-primary/40" href={`/boss/profiles/${profile.id}`} key={profile.id}>
                  <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3">
                    <div className="size-16 overflow-hidden rounded-full bg-primary/10"><ProfileAvatar profile={profile} /></div>
                    <div className="min-w-0">
                      <h2 className="break-words text-lg font-bold">{profile.name}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">{location ? <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{location}</span> : "Location not set"}{profile.primaryContactName ? ` · ${profile.primaryContactName}` : ""}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{profile.contactCount} contacts · {profile.bookingCount} events · {profile.locationCount} locations</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
          {data.pageCount > 1 ? (
            <nav aria-label="Profile pages" className="flex items-center justify-between">
              {data.page > 1 ? <Link className="button-secondary" href={href(data.page - 1)}>Previous</Link> : <span />}
              <span className="text-sm text-muted-foreground">Page {data.page} of {data.pageCount}</span>
              {data.page < data.pageCount ? <Link className="button-secondary" href={href(data.page + 1)}>Next</Link> : <span />}
            </nav>
          ) : null}
        </>
      ) : !error ? <p className="text-sm text-muted-foreground">Loading profiles…</p> : null}
    </div>
  );
}
