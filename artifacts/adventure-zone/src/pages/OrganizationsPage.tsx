import { useCallback, useEffect, useState } from "react";
import { useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { getArchivedProfiles } from "@/actions/profile-lifecycle";
import { OrganizationList } from "@/components/organizations/organization-list";
import { DuplicatesView, type DuplicateGroup } from "@/components/organizations/duplicates-view";
import { organizationListQuerySchema } from "@/features/organizations/last-resort-input";
import { Toaster } from "@/components/ui/toaster";
import { EventFamilySuggestions } from "@/components/event-families/event-family-suggestions";
import { EventFamilyCard } from "@/components/event-families/event-family-card";

function withoutArchivedProfiles(data: any, archivedIds: Set<string>) {
  const organizations = Array.isArray(data?.organizations)
    ? data.organizations.filter((profile: any) => !archivedIds.has(String(profile.id)))
    : data?.organizations;
  const families = Array.isArray(data?.families)
    ? data.families
        .map((family: any) => ({
          ...family,
          members: Array.isArray(family.members)
            ? family.members.filter((member: any) => !archivedIds.has(String(member.organizationId ?? member.id)))
            : family.members,
        }))
        .filter((family: any) => !Array.isArray(family.members) || family.members.length > 0)
    : data?.families;
  return { ...data, organizations, families };
}

export default function OrganizationsPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const query = organizationListQuerySchema.parse({
    q: params.get("q") ?? undefined,
    lastResort: params.get("lastResort") ?? undefined,
    leg: params.get("leg") ?? undefined,
    type: params.get("type") ?? undefined,
    region: params.get("region") ?? undefined,
    hasPhone: params.get("hasPhone") ?? undefined,
    hasEmail: params.get("hasEmail") ?? undefined,
    hasFollowUp: params.get("hasFollowUp") ?? undefined,
    hasBooking: params.get("hasBooking") ?? undefined,
    hasLocations: params.get("hasLocations") ?? undefined,
    showMembers: params.get("showMembers") ?? undefined,
    contact: params.get("contact") ?? undefined,
    activity: params.get("activity") ?? undefined,
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
  });

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());

  const [showDuplicates, setShowDuplicates] = useState(false);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupError, setDupError] = useState<string | null>(null);
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[] | null>(null);

  const loadProfiles = useCallback(async () => {
    const qs = new URLSearchParams();
    if (query.search) qs.set("q", query.search);
    if (query.lastResort !== "all") qs.set("lastResort", query.lastResort);
    if (query.travelLegId) qs.set("leg", query.travelLegId);
    if (query.placeType) qs.set("type", query.placeType);
    if (query.region) qs.set("region", query.region);
    if (query.hasPhone) qs.set("hasPhone", "yes");
    if (query.hasEmail) qs.set("hasEmail", "yes");
    if (query.hasFollowUp) qs.set("hasFollowUp", "yes");
    if (query.hasBooking) qs.set("hasBooking", "yes");
    if (query.hasLocations) qs.set("hasLocations", "yes");
    if (query.showMembers) qs.set("showMembers", "yes");
    if (query.page > 1) qs.set("page", String(query.page));
    if (query.pageSize !== 50) qs.set("pageSize", String(query.pageSize));

    setLoading(true);
    setError(null);
    try {
      const [profiles, archived] = await Promise.all([
        apiGet<any>(`/organizations?${qs.toString()}`),
        getArchivedProfiles(),
      ]);
      const ids = new Set(archived.map((profile) => profile.id));
      setArchivedIds(ids);
      setData(withoutArchivedProfiles(profiles, ids));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load profiles");
    } finally {
      setLoading(false);
    }
  }, [query.search, query.lastResort, query.travelLegId, query.placeType, query.region, query.hasPhone, query.hasEmail, query.hasFollowUp, query.hasBooking, query.hasLocations, query.showMembers, query.page, query.pageSize]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const loadDuplicates = useCallback(async () => {
    setDupLoading(true);
    setDupError(null);
    try {
      const result = await apiGet<{ groups: DuplicateGroup[] }>("/organizations/duplicates");
      const groups = result.groups
        .map((group: any) => ({
          ...group,
          candidateIds: (group.candidateIds ?? []).filter((id: string) => !archivedIds.has(id)),
          organizations: (group.organizations ?? []).filter((organization: any) => !archivedIds.has(String(organization.id))),
        }))
        .filter((group: any) => group.organizations.length >= 2);
      setDupGroups(groups);
      return groups;
    } catch (e: any) {
      setDupError(e.message ?? "Failed to load duplicates");
      return null;
    } finally {
      setDupLoading(false);
    }
  }, [archivedIds]);

  function handleFindDuplicates() {
    setShowDuplicates(true);
    loadDuplicates();
  }

  function handleDone() {
    setShowDuplicates(false);
    setDupGroups(null);
  }

  const families = data?.families ?? [];

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Relationships</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Profiles</h1>
          {!showDuplicates ? (
            <button className="button-secondary flex items-center gap-2" onClick={handleFindDuplicates}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Find Duplicates
            </button>
          ) : (
            <button className="button-secondary" onClick={handleDone}>← Back to profiles</button>
          )}
        </div>
        {!showDuplicates ? (
          <p className="mt-2 max-w-2xl text-slate-600">
            Find a fair, event, venue, organization, or company and the contacts you can call there. Grouped members stay tucked under their family/group unless you search for them or turn on the member filter.
          </p>
        ) : null}
      </header>

      {showDuplicates ? (
        <div className="grid gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Duplicate place profiles</h2>
            {dupGroups !== null && !dupLoading ? (
              <span className="rounded-full bg-amber-100 px-3 py-0.5 text-sm font-bold text-amber-800">
                {dupGroups.length} group{dupGroups.length !== 1 ? "s" : ""} with duplicates
              </span>
            ) : null}
          </div>
          {dupLoading && dupGroups === null ? (
            <p className="text-slate-500">Scanning for duplicates…</p>
          ) : dupGroups !== null ? (
            <>
              {dupError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <p className="text-rose-700">Could not refresh duplicate status: {dupError}</p>
                  <button className="button-secondary mt-3" onClick={loadDuplicates}>Retry status refresh</button>
                </div>
              ) : null}
              <DuplicatesView groups={dupGroups} onRefresh={loadDuplicates} />
            </>
          ) : dupError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-rose-700">{dupError}</p>
              <button className="button-secondary mt-3" onClick={loadDuplicates}>Retry</button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {families.length > 0 ? (
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">Event families</h2>
                <span className="text-sm text-slate-500">Open a family to manage its events.</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {families.map((family: any) => <EventFamilyCard key={family.id} family={family} />)}
              </div>
            </section>
          ) : null}

          {loading ? (
            <p className="text-slate-500">Loading places…</p>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">{error}</p></div>
          ) : data ? (
            <OrganizationList organizations={data.organizations ?? data} query={query} travelLegs={data.travelLegs ?? []} />
          ) : null}

          <EventFamilySuggestions compact onChanged={loadProfiles} />
        </>
      )}

      <Toaster />
    </div>
  );
}
