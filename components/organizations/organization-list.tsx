import Link from "next/link";

import type {
  OrganizationListQuery,
  OrganizationListPage,
} from "@/features/organizations/organization-repository";

function listHref(query: OrganizationListQuery) {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  if (query.lastResort === "only") params.set("lastResort", "only");
  if (query.travelLegId) params.set("leg", query.travelLegId);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.pageSize !== 50) params.set("pageSize", String(query.pageSize));
  const suffix = params.toString();
  return suffix ? `/organizations?${suffix}` : "/organizations";
}

function detailHref(organizationId: string, query: OrganizationListQuery) {
  const params = new URLSearchParams({ returnTo: listHref(query) });
  return `/organizations/${organizationId}?${params.toString()}`;
}

export function OrganizationList({
  organizations,
  query,
  travelLegs,
}: {
  organizations: OrganizationListPage;
  query: OrganizationListQuery;
  travelLegs: { id: string; name: string; color: string }[];
}) {
  return (
    <div className="grid gap-5">
      <form
        action="/organizations"
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_12rem_14rem_auto]"
        method="get"
      >
        <label className="grid gap-1 text-sm font-semibold">
          Search places and contacts
          <input
            defaultValue={query.search}
            name="q"
            placeholder="Place name"
            type="search"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Place status
          <select defaultValue={query.lastResort} name="lastResort">
            <option value="all">All places</option>
            <option value="only">Last Resort only</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Travel leg
          <select defaultValue={query.travelLegId ?? ""} name="leg">
            <option value="">All travel legs</option>
            {travelLegs.map((leg) => (
              <option key={leg.id} value={leg.id}>
                {leg.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="button-primary" type="submit">
            Search
          </button>
          <Link className="button-secondary" href="/organizations">
            Reset
          </Link>
        </div>
      </form>

      <p aria-live="polite" className="text-sm text-slate-600">
        Showing {organizations.records.length} of {organizations.total} places
      </p>

      {organizations.records.length ? (
        <ul className="grid gap-3">
          {organizations.records.map((organization) => (
            <li
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              key={organization.id}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      className="text-lg font-bold hover:text-orange-700"
                      href={detailHref(organization.id, query)}
                    >
                      {organization.name}
                    </Link>
                    {organization.lastResort ? (
                      <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">
                        Last Resort
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {organization.contactCount} contacts to call · {organization.bookingCount} booking opportunities
                  </p>
                  {organization.lastResortReason ? (
                    <p className="mt-2 text-sm text-rose-800">
                      {organization.lastResortReason}
                    </p>
                  ) : null}
                </div>
                <Link className="button-secondary text-center" href={detailHref(organization.id, query)}>
                  View place
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="font-semibold">No places match these filters.</p>
          <Link className="button-secondary mt-3 inline-flex" href={listHref({ search: "", lastResort: "all", travelLegId: null, page: 1, pageSize: 50 })}>
            Reset filters
          </Link>
        </div>
      )}
      {organizations.pageCount > 1 ? (
        <nav aria-label="Places pages" className="flex items-center justify-between gap-3">
          {organizations.page > 1 ? (
            <Link className="button-secondary" href={listHref({ ...query, page: organizations.page - 1 })}>
              Previous
            </Link>
          ) : <span />}
          <p className="text-sm font-semibold text-slate-600">
            Page {organizations.page} of {organizations.pageCount}
          </p>
          {organizations.page < organizations.pageCount ? (
            <Link className="button-secondary" href={listHref({ ...query, page: organizations.page + 1 })}>
              Next
            </Link>
          ) : <span />}
        </nav>
      ) : null}
    </div>
  );
}
