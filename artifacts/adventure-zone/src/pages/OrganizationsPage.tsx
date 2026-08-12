import { useCallback, useEffect, useState } from "react";
import { useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { OrganizationList } from "@/components/organizations/organization-list";
import { DuplicatesView, type DuplicateGroup } from "@/components/organizations/duplicates-view";
import { organizationListQuerySchema } from "@/features/organizations/last-resort-input";
import { Toaster } from "@/components/ui/toaster";

export default function OrganizationsPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const query = organizationListQuerySchema.parse({
    q: params.get("q") ?? undefined,
    lastResort: params.get("lastResort") ?? undefined,
    leg: params.get("leg") ?? undefined,
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
  });

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showDuplicates, setShowDuplicates] = useState(false);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupError, setDupError] = useState<string | null>(null);
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[] | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (query.search) qs.set("q", query.search);
    if (query.lastResort !== undefined) qs.set("lastResort", String(query.lastResort));
    if (query.travelLegId) qs.set("leg", query.travelLegId);
    if (query.page && query.page > 1) qs.set("page", String(query.page));

    apiGet<any>(`/organizations?${qs.toString()}`)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [search]);

  const loadDuplicates = useCallback(async () => {
    setDupLoading(true);
    setDupError(null);
    try {
      const result = await apiGet<{ groups: DuplicateGroup[] }>("/organizations/duplicates");
      setDupGroups(result.groups);
    } catch (e: any) {
      setDupError(e.message ?? "Failed to load duplicates");
    } finally {
      setDupLoading(false);
    }
  }, []);

  function handleFindDuplicates() {
    setShowDuplicates(true);
    loadDuplicates();
  }

  function handleDone() {
    setShowDuplicates(false);
    setDupGroups(null);
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Relationships
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Profiles</h1>
          {!showDuplicates ? (
            <button
              className="button-secondary flex items-center gap-2"
              onClick={handleFindDuplicates}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Find Duplicates
            </button>
          ) : (
            <button className="button-secondary" onClick={handleDone}>
              ← Back to profiles
            </button>
          )}
        </div>
        {!showDuplicates && (
          <p className="mt-2 max-w-2xl text-slate-600">
            Find a fair, city, venue, or company and the contacts you can call there.
          </p>
        )}
      </header>

      {showDuplicates ? (
        <div className="grid gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Duplicate place profiles</h2>
            {dupGroups !== null && !dupLoading && (
              <span className="rounded-full bg-amber-100 px-3 py-0.5 text-sm font-bold text-amber-800">
                {dupGroups.length} group{dupGroups.length !== 1 ? "s" : ""} with duplicates
              </span>
            )}
          </div>
          {dupLoading && dupGroups === null ? (
            <p className="text-slate-500">Scanning for duplicates…</p>
          ) : dupGroups !== null ? (
            <>
              {dupError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <p className="text-rose-700">
                    Could not refresh duplicate status: {dupError}
                  </p>
                  <button className="button-secondary mt-3" onClick={loadDuplicates}>
                    Retry status refresh
                  </button>
                </div>
              ) : null}
              <DuplicatesView groups={dupGroups} onRefresh={loadDuplicates} />
            </>
          ) : dupError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-rose-700">{dupError}</p>
              <button className="button-secondary mt-3" onClick={loadDuplicates}>
                Retry
              </button>
            </div>
          ) : null}
        </div>
      ) : loading ? (
        <p className="text-slate-500">Loading places…</p>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-rose-700">{error}</p>
        </div>
      ) : data ? (
        <OrganizationList
          organizations={data.organizations ?? data}
          query={query}
          travelLegs={data.travelLegs ?? []}
        />
      ) : null}

      <Toaster />
    </div>
  );
}
