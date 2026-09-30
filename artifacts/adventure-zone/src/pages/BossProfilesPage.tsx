import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { LoaderCircle, MapPin, Search } from "lucide-react";
import { bossGet } from "@/lib/boss-auth-context";
import { BossProfileDirectoryNav } from "@/components/boss/boss-profile-directory-nav";

type ProfileRecord = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  primaryContactName: string | null;
  contactCount: number;
  bookingCount: number;
  locationCount: number;
};
type Family = { id: string; name: string; description: string | null; memberCount: number; matchedMemberCount: number };
type Page = { records: ProfileRecord[]; families: Family[]; total: number; page: number; pageCount: number };

export default function BossProfilesPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [page, setPage] = useState(() => Math.max(1, Number(params.get("page") ?? 1) || 1));
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    let active = true;
    setIsSearching(true);
    const timeout = window.setTimeout(() => {
      const qs = new URLSearchParams();
      const term = query.trim();
      if (term) qs.set("q", term);
      if (page > 1) qs.set("page", String(page));
      bossGet<Page>(`/boss/profiles?${qs}`)
        .then((next) => { if (active) { setData(next); setError(""); } })
        .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load profiles."); })
        .finally(() => { if (active) setIsSearching(false); });
    }, query.trim() ? 150 : 0);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [query, page]);

  return (
    <div className="grid gap-5" data-testid="boss-profiles-page">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss</p>
        <h1 className="mt-1 text-2xl font-bold">Profiles</h1>
        <p className="mt-1 text-sm text-muted-foreground">Event organizations, contacts, locations, bookings, and history.</p>
      </header>
      <BossProfileDirectoryNav active="profiles" />
      <div className="relative">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search profiles</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input aria-label="Search profiles" className="w-full rounded-lg border border-input bg-background py-2 pr-10" onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search profiles, contacts, or cities" style={{ paddingLeft: "3rem" }} value={query} />
          {isSearching ? <span aria-label="Searching profiles" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-primary" role="status"><LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /></span> : null}
        </label>
      </div>
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
              {data.page > 1 ? <button className="button-secondary" onClick={() => setPage(data.page - 1)} type="button">Previous</button> : <span />}
              <span className="text-sm text-muted-foreground">Page {data.page} of {data.pageCount}</span>
              {data.page < data.pageCount ? <button className="button-secondary" onClick={() => setPage(data.page + 1)} type="button">Next</button> : <span />}
            </nav>
          ) : null}
        </>
      ) : !error ? <p className="text-sm text-muted-foreground">Loading profiles…</p> : null}
    </div>
  );
}
