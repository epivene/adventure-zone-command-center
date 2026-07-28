import Link from "next/link";

import type {
  OrganizationListQuery,
  OrganizationSummary,
} from "@/features/organizations/organization-repository";

function listHref(query: OrganizationListQuery) {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  if (query.lastResort === "only") params.set("lastResort", "only");
  if (query.travelLegId) params.set("leg", query.travelLegId);
  const suffix = params.toString();
  return suffix ? `/organizations?${suffix}` : "/organizations";
}

export function OrganizationList({
  organizations,
  query,
  travelLegs,
}: {
  organizations: OrganizationSummary[];
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
          Search accounts
          <input
            defaultValue={query.search}
            name="q"
            placeholder="Organization name"
            type="search"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Account status
          <select defaultValue={query.lastResort} name="lastResort">
            <option value="all">All accounts</option>
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
        Showing {organizations.length} accounts
      </p>

      {organizations.length ? (
        <ul className="grid gap-3">
          {organizations.map((organization) => (
            <li
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              key={organization.id}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      className="text-lg font-bold hover:text-orange-700"
                      href={`/organizations/${organization.id}`}
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
                    {organization.contacts.length} contacts · {organization.bookings.length} bookings
                  </p>
                  {organization.lastResortReason ? (
                    <p className="mt-2 text-sm text-rose-800">
                      {organization.lastResortReason}
                    </p>
                  ) : null}
                </div>
                <Link className="button-secondary text-center" href={`/organizations/${organization.id}`}>
                  View account
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="font-semibold">No accounts match these filters.</p>
          <Link className="button-secondary mt-3 inline-flex" href={listHref({ search: "", lastResort: "all", travelLegId: null })}>
            Reset filters
          </Link>
        </div>
      )}
    </div>
  );
}
