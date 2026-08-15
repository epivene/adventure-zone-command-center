import { Link } from "wouter";

import type {
  OrganizationListQuery,
  OrganizationListPage,
} from "@/features/organizations/organization-repository";

function listHref(query: OrganizationListQuery) {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  if (query.lastResort === "only") params.set("lastResort", "only");
  if (query.travelLegId) params.set("leg", query.travelLegId);
  if (query.placeType) params.set("type", query.placeType);
  if (query.region) params.set("region", query.region);
  if (query.hasPhone) params.set("hasPhone", "yes");
  if (query.hasEmail) params.set("hasEmail", "yes");
  if (query.hasFollowUp) params.set("hasFollowUp", "yes");
  if (query.hasBooking) params.set("hasBooking", "yes");
  if (query.hasLocations) params.set("hasLocations", "yes");
  if (query.page > 1) params.set("page", String(query.page));
  if (query.pageSize !== 50) params.set("pageSize", String(query.pageSize));
  const suffix = params.toString();
  return suffix ? `/profiles?${suffix}` : "/profiles";
}

function detailHref(organizationId: string, query: OrganizationListQuery) {
  const params = new URLSearchParams({ returnTo: listHref(query) });
  return `/profiles/${organizationId}?${params.toString()}`;
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
        action="/profiles"
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
        method="get"
      >
        <label className="grid gap-1 text-sm font-semibold">
          Search profiles and contacts
          <input
            defaultValue={query.search}
            name="q"
            placeholder="Name, city, contact, phone, or email"
            type="search"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">Profile type<select defaultValue={query.placeType ?? ""} name="type"><option value="">All profile types</option><option value="event">Event</option><option value="venue">Venue</option><option value="company">Company</option></select></label>
        <label className="grid gap-1 text-sm font-semibold">State/region<input defaultValue={query.region ?? ""} name="region" placeholder="Colorado or CO" /></label>
        <fieldset className="grid gap-2 text-sm font-semibold">
          <legend>Contact details</legend>
          <label className="flex items-center gap-2 font-normal">
            <input defaultChecked={query.hasPhone} name="hasPhone" type="checkbox" value="yes" />
            Has phone
          </label>
          <label className="flex items-center gap-2 font-normal">
            <input defaultChecked={query.hasEmail} name="hasEmail" type="checkbox" value="yes" />
            Has email
          </label>
        </fieldset>
        <fieldset className="grid gap-2 text-sm font-semibold">
          <legend>Activity</legend>
          <label className="flex items-center gap-2 font-normal">
            <input defaultChecked={query.hasFollowUp} name="hasFollowUp" type="checkbox" value="yes" />
            Has follow-up
          </label>
          <label className="flex items-center gap-2 font-normal">
            <input defaultChecked={query.hasBooking} name="hasBooking" type="checkbox" value="yes" />
            Has booking
          </label>
        </fieldset>
        <label className="grid gap-1 text-sm font-semibold">Locations<select defaultValue={query.hasLocations ? "yes" : ""} name="hasLocations"><option value="">Any location count</option><option value="yes">Has possible locations</option></select></label>
        <label className="grid gap-1 text-sm font-semibold">
          Place status
          <select defaultValue={query.lastResort} name="lastResort">
            <option value="all">All profiles</option>
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
          <Link className="button-secondary" href="/profiles">
            Reset
          </Link>
        </div>
      </form>

      <p aria-live="polite" className="text-sm text-slate-600">
        Showing {organizations.records.length} of {organizations.total} profiles
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
                  <p className="mt-1 text-sm text-slate-500">
                    {[organization.city, organization.region].filter(Boolean).join(", ")}
                    {organization.primaryContactName ? (
                      <span className="ml-2 font-medium text-slate-700">· {organization.primaryContactName}</span>
                    ) : null}
                  </p>
                  {organization.matchedLocation ? (
                    <p className="mt-0.5 text-xs text-slate-500">
                      via{" "}
                      <span className="font-medium text-slate-700">
                        {organization.matchedLocation.label}
                        {organization.matchedLocation.city
                          ? ` · ${[organization.matchedLocation.city, organization.matchedLocation.region].filter(Boolean).join(", ")}`
                          : null}
                      </span>
                    </p>
                  ) : null}
                  {organization.locationCount > 0 ? (
                    <p className="mt-0.5 text-sm font-medium text-slate-600">
                      {organization.locationCount} location{organization.locationCount !== 1 ? "s" : ""}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-sm text-slate-600">
                    {organization.contactCount} contacts · {organization.bookingCount} booking{organization.bookingCount !== 1 ? "s" : ""}
                  </p>
                  {organization.lastResortReason ? (
                    <p className="mt-2 text-sm text-rose-800">
                      {organization.lastResortReason}
                    </p>
                  ) : null}
                </div>
                <Link className="button-secondary text-center" href={detailHref(organization.id, query)}>
                  View profile
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="font-semibold">No profiles match these filters.</p>
          <Link className="button-secondary mt-3 inline-flex" href="/profiles">
            Reset filters
          </Link>
        </div>
      )}
      {organizations.pageCount > 1 ? (
        <nav aria-label="Profiles pages" className="flex items-center justify-between gap-3">
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
