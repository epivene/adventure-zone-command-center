import { Link } from "wouter";

import { profileTypeOptions } from "@/features/organizations/last-resort-input";
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
  if (query.showMembers) params.set("showMembers", "yes");
  if (query.page > 1) params.set("page", String(query.page));
  if (query.pageSize !== 50) params.set("pageSize", String(query.pageSize));
  const suffix = params.toString();
  return suffix ? `/profiles?${suffix}` : "/profiles";
}

function detailHref(organizationId: string, query: OrganizationListQuery) {
  const params = new URLSearchParams({ returnTo: listHref(query) });
  return `/profiles/${organizationId}?${params.toString()}`;
}

export function OrganizationList({ organizations, query, travelLegs }: { organizations: OrganizationListPage; query: OrganizationListQuery; travelLegs: { id: string; name: string; color: string }[] }) {
  const profileTypeLabel = profileTypeOptions.find((option) => option.value === query.placeType)?.label;
  const legLabel = travelLegs.find((leg) => leg.id === query.travelLegId)?.name;
  const activeFilters = [
    query.placeType ? profileTypeLabel ?? query.placeType : null,
    query.region ? `Region: ${query.region}` : null,
    query.lastResort === "only" ? "Last Resort" : null,
    query.travelLegId ? `Leg: ${legLabel ?? "selected"}` : null,
    query.hasPhone ? "Has phone" : null,
    query.hasEmail ? "Has email" : null,
    query.hasFollowUp ? "Has follow-up" : null,
    query.hasBooking ? "Has booking" : null,
    query.hasLocations ? "Has locations" : null,
    query.showMembers ? "Showing family members" : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="grid gap-4">
      <form action="/profiles" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" method="get">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Search profiles and contacts</span>
            <input className="min-h-11 w-full" defaultValue={query.search} name="q" placeholder="Search profiles, contacts, cities, phone, email…" type="search" />
          </label>
          <div className="flex gap-2">
            <button className="button-primary flex-1 sm:flex-none" type="submit">Search</button>
            <Link className="button-secondary flex-1 text-center sm:flex-none" href="/profiles">Clear</Link>
          </div>
        </div>

        <details className="group mt-2">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <span>Filters</span>
            {activeFilters.length ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-800">{activeFilters.length}</span> : null}
            <span className="ml-auto text-slate-400 transition group-open:rotate-180">⌄</span>
          </summary>

          <div className="mt-2 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="grid gap-1 text-sm font-semibold">Profile type
              <select defaultValue={query.placeType ?? ""} name="type"><option value="">All profile types</option>{profileTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">State / region<input defaultValue={query.region ?? ""} name="region" placeholder="Colorado or CO" /></label>
            <label className="grid gap-1 text-sm font-semibold">Travel leg
              <select defaultValue={query.travelLegId ?? ""} name="leg"><option value="">All travel legs</option>{travelLegs.map((leg) => <option key={leg.id} value={leg.id}>{leg.name}</option>)}</select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">Profile status
              <select defaultValue={query.lastResort} name="lastResort"><option value="all">All profiles</option><option value="only">Last Resort only</option></select>
            </label>
            <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-2">
              {[
                ["hasPhone", query.hasPhone, "Has phone"],
                ["hasEmail", query.hasEmail, "Has email"],
                ["hasFollowUp", query.hasFollowUp, "Has follow-up"],
                ["hasBooking", query.hasBooking, "Has booking"],
                ["hasLocations", query.hasLocations, "Has locations"],
                ["showMembers", query.showMembers, "Show family members"],
              ].map(([name, checked, label]) => <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm" key={String(name)}><input defaultChecked={Boolean(checked)} name={String(name)} type="checkbox" value="yes" />{String(label)}</label>)}
            </div>
            <div className="flex items-end"><button className="button-secondary w-full" type="submit">Apply filters</button></div>
          </div>
        </details>

        {activeFilters.length ? <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3" aria-label="Active filters">{activeFilters.map((filter) => <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700" key={filter}>{filter}</span>)}</div> : null}
      </form>

      <p aria-live="polite" className="text-sm text-slate-600">Showing {organizations.records.length} of {organizations.total} profiles</p>

      {organizations.records.length ? (
        <ul className="grid gap-2">
          {organizations.records.map((organization) => (
            <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={organization.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><Link className="break-words text-lg font-bold hover:text-orange-700" href={detailHref(organization.id, query)}>{organization.name}</Link>{organization.lastResort ? <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">Last Resort</span> : null}</div>
                  {organization.parentContext ? <p className="mt-1 text-xs font-semibold text-orange-700">{organization.parentContext.kind === "event_family" ? "Part of" : "Location of"} {organization.parentContext.name}</p> : null}
                  <p className="mt-1 text-sm text-slate-500">{[organization.city, organization.region].filter(Boolean).join(", ")}{organization.primaryContactName ? <span className="ml-2 font-medium text-slate-700">· {organization.primaryContactName}</span> : null}</p>
                  {organization.locationCount > 0 ? <p className="mt-0.5 text-sm text-slate-600">{organization.locationCount} location{organization.locationCount !== 1 ? "s" : ""} · {organization.contactCount} contact{organization.contactCount !== 1 ? "s" : ""} · {organization.bookingCount} booking{organization.bookingCount !== 1 ? "s" : ""}</p> : <p className="mt-0.5 text-sm text-slate-600">{organization.contactCount} contact{organization.contactCount !== 1 ? "s" : ""} · {organization.bookingCount} booking{organization.bookingCount !== 1 ? "s" : ""}</p>}
                </div>
                <Link aria-label={`Open ${organization.name}`} className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-orange-700 hover:bg-orange-50" href={detailHref(organization.id, query)}>Open</Link>
              </div>
            </li>
          ))}
        </ul>
      ) : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"><p className="font-semibold">No profiles match these filters.</p><Link className="button-secondary mt-3 inline-flex" href="/profiles">Clear filters</Link></div>}

      {organizations.pageCount > 1 ? <nav aria-label="Profiles pages" className="flex items-center justify-between gap-3">{organizations.page > 1 ? <Link className="button-secondary" href={listHref({ ...query, page: organizations.page - 1 })}>Previous</Link> : <span />}<p className="text-sm font-semibold text-slate-600">Page {organizations.page} of {organizations.pageCount}</p>{organizations.page < organizations.pageCount ? <Link className="button-secondary" href={listHref({ ...query, page: organizations.page + 1 })}>Next</Link> : <span />}</nav> : null}
    </div>
  );
}
