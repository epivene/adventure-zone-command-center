import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { OrganizationList } from "@/components/organizations/organization-list";
import { organizationListQuerySchema } from "@/features/organizations/last-resort-input";

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

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Relationships
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Places</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Find a fair, city, venue, or company and the contacts you can call there.
        </p>
      </header>

      {loading ? (
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
    </div>
  );
}
