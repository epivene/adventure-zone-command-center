import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { bossGet } from "@/lib/boss-auth-context";
import { BossProfileDirectoryNav } from "@/components/boss/boss-profile-directory-nav";
import { OrganizationList } from "@/components/organizations/organization-list";
import { organizationListQuerySchema } from "@/features/organizations/last-resort-input";
import type { OrganizationListPage } from "@/features/organizations/organization-repository";
import { readProfileReturnState } from "@/lib/profile-navigation";

type Directory = OrganizationListPage & {
  families: Array<{ id: string; name: string; memberCount: number }>;
  travelLegs: Array<{ id: string; name: string; color: string }>;
};

export default function BossProfilesPage() {
  const search = useSearch();
  const query = organizationListQuerySchema.parse({
    ...Object.fromEntries(new URLSearchParams(search)),
    lastResort: "all", filler: "all", includeRetired: undefined,
  });
  const [data, setData] = useState<Directory | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void bossGet<Directory>(`/boss/profiles?${new URLSearchParams(search)}`)
      .then((next) => { if (active) setData(next); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load profiles."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search]);

  useEffect(() => {
    if (loading || !data) return;
    const saved = readProfileReturnState();
    if (saved?.path !== window.location.pathname + window.location.search) return;
    const frame = requestAnimationFrame(() => window.scrollTo(0, saved.scrollY));
    return () => cancelAnimationFrame(frame);
  }, [loading, data]);

  const families = data?.families ?? [];
  const familySection = families.length ? (
    <details className="rounded-xl border border-border bg-card p-4">
      <summary className="cursor-pointer font-bold">Event Families ({families.length})</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{families.map((family) => (
        <div className="rounded-lg border border-border p-3" key={family.id}>
          <p className="font-bold">{family.name}</p>
          <p className="text-sm text-muted-foreground">{family.memberCount} linked profiles</p>
        </div>
      ))}</div>
    </details>
  ) : null;
  const organizations = data ? {
    ...data,
    records: data.records.map((record) => ({
      ...record,
      lastResort: false, lastResortReason: null, lastResortChangedAt: null,
      filler: false, fillerReason: null, fillerChangedAt: null, matchedLocation: null,
    })),
  } : null;

  return (
    <div className="mx-auto grid min-w-0 max-w-7xl gap-5" data-testid="boss-profiles-page">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Relationships</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Profiles</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Events, fairs, companies, venues, schools, cities, and other places all live together as profiles.</p>
      </header>
      <BossProfileDirectoryNav active="profiles" />
      {error ? <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-destructive">{error}</p> : null}
      {organizations ? <OrganizationList organizations={organizations} query={query}
        travelLegs={data?.travelLegs ?? []} afterSearch={familySection} loading={loading}
        basePath="/boss/profiles" showExports={false} showStrategyFilters={false} /> : loading ? <p>Loading profiles…</p> : null}
    </div>
  );
}
