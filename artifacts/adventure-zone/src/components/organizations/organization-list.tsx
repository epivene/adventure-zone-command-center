import { Link } from "wouter";
import { useLocation } from "wouter";
import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { LoaderCircle, Search } from "lucide-react";

import { profileTypeOptions } from "@/features/organizations/last-resort-input";
import type { OrganizationListQuery, OrganizationListPage } from "@/features/organizations/organization-repository";
import { normalizeExternalWebsite } from "@/features/organizations/website-url";

function listHref(query: OrganizationListQuery) {
  const params = new URLSearchParams();
  if (query.directoryView && query.directoryView !== "all") params.set("view", query.directoryView);
  if (query.search) params.set("q", query.search);
  if (query.lastResort === "only") params.set("lastResort", "only");
  if (query.filler === "only") params.set("filler", "only");
  if (query.travelLegId) params.set("leg", query.travelLegId);
  if (query.placeType) params.set("type", query.placeType);
  if (query.region) params.set("region", query.region);
  if (query.hasPhone) params.set("hasPhone", "yes");
  if (query.hasEmail) params.set("hasEmail", "yes");
  if (query.hasFollowUp) params.set("hasFollowUp", "yes");
  if (query.hasBooking) params.set("hasBooking", "yes");
  if (query.hasLocations) params.set("hasLocations", "yes");
  if (query.showMembers) params.set("showMembers", "yes");
  if (query.sort !== "recently_updated") params.set("sort", query.sort);
  if (query.includeRetired) params.set("includeRetired", "true");
  if (query.page > 1) params.set("page", String(query.page));
  if (query.pageSize !== 50) params.set("pageSize", String(query.pageSize));
  const suffix = params.toString();
  return suffix ? `/profiles?${suffix}` : "/profiles";
}

function detailHref(organizationId: string, query: OrganizationListQuery) {
  const params = new URLSearchParams({ returnTo: listHref(query) });
  return `/profiles/${organizationId}?${params.toString()}`;
}

type ActiveFilter = { label: string; href: string };

function ProfileAvatar({ name, image }: { name: string; image?: string | null }) {
  if (image) return <img alt={`${name} profile`} className="h-full w-full object-cover" src={image} />;
  return (
    <div aria-label={`${name} profile placeholder`} className="flex h-full w-full items-center justify-center text-orange-700" role="img">
      <svg aria-hidden="true" className="h-11 w-11" fill="none" viewBox="0 0 64 64">
        <circle cx="32" cy="22" r="11" stroke="currentColor" strokeWidth="3.5" />
        <path d="M14 52c0-10 8-18 18-18s18 8 18 18" stroke="currentColor" strokeLinecap="round" strokeWidth="3.5" />
      </svg>
    </div>
  );
}

function RatingSummary({ average, count }: { average?: number | null; count?: number }) {
  const rating = average ?? 0;
  const total = count ?? 0;
  return (
    <div className="min-w-[7rem] text-right" data-testid="profile-rating-summary">
      <p className="text-xl font-bold leading-tight text-slate-950">{rating.toFixed(1)} <span className="text-sm font-semibold text-slate-400">/ 5</span></p>
      <div aria-label={`${rating.toFixed(1)} out of 5 stars`} className="mt-1 text-2xl leading-none tracking-tight text-orange-600">☆☆☆☆☆</div>
      <p className="mt-1 text-xs text-slate-500">{total} rated occurrence{total === 1 ? "" : "s"}</p>
    </div>
  );
}

export function OrganizationList({ organizations, query, travelLegs, afterSearch, loading = false }: { organizations: OrganizationListPage; query: OrganizationListQuery; travelLegs: { id: string; name: string; color: string }[]; afterSearch?: ReactNode; loading?: boolean }) {
  const [, setLocation] = useLocation();
  const [searchValue, setSearchValue] = useState(query.search);
  const [pendingSearch, setPendingSearch] = useState(false);
  const profileTypeLabel = profileTypeOptions.find((option) => option.value === query.placeType)?.label;
  const legLabel = travelLegs.find((leg) => leg.id === query.travelLegId)?.name;
  const activeFilters: ActiveFilter[] = [
    query.placeType ? { label: profileTypeLabel ?? query.placeType, href: listHref({ ...query, placeType: null, page: 1 }) } : null,
    query.region ? { label: `Region: ${query.region}`, href: listHref({ ...query, region: null, page: 1 }) } : null,
    query.lastResort === "only" ? { label: "Last Resort", href: listHref({ ...query, lastResort: "all", page: 1 }) } : null,
    query.filler === "only" ? { label: "Filler", href: listHref({ ...query, filler: "all", page: 1 }) } : null,
    query.travelLegId ? { label: `Leg: ${legLabel ?? "selected"}`, href: listHref({ ...query, travelLegId: null, page: 1 }) } : null,
    query.hasPhone ? { label: "Has phone", href: listHref({ ...query, hasPhone: false, page: 1 }) } : null,
    query.hasEmail ? { label: "Has email", href: listHref({ ...query, hasEmail: false, page: 1 }) } : null,
    query.hasFollowUp ? { label: "Has follow-up", href: listHref({ ...query, hasFollowUp: false, page: 1 }) } : null,
    query.hasBooking ? { label: "Has booking", href: listHref({ ...query, hasBooking: false, page: 1 }) } : null,
    query.hasLocations ? { label: "Has locations", href: listHref({ ...query, hasLocations: false, page: 1 }) } : null,
    query.showMembers ? { label: "Showing family members", href: listHref({ ...query, showMembers: false, page: 1 }) } : null,
  ].filter((value): value is ActiveFilter => Boolean(value));
  const directoryReset = listHref({ ...query, search: "", lastResort: "all", filler: "all", travelLegId: null, placeType: null, region: null, hasPhone: false, hasEmail: false, hasFollowUp: false, hasBooking: false, hasLocations: false, showMembers: false, page: 1 });

  useEffect(() => { setSearchValue(query.search); }, [query.search]);
  useEffect(() => {
    if (searchValue === query.search) return;
    const id = window.setTimeout(() => setLocation(listHref({ ...query, search: searchValue.trim(), page: 1 })), 150);
    return () => window.clearTimeout(id);
  }, [query, query.search, searchValue, setLocation]);
  useEffect(() => {
    if (!loading && searchValue === query.search) setPendingSearch(false);
  }, [loading, query.search, searchValue]);
  const searching = pendingSearch || loading;

  return (
    <div className="grid gap-4">
      <form action="/profiles" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" method="get">
        {query.directoryView && query.directoryView !== "all" ? <input name="view" type="hidden" value={query.directoryView} /> : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search profiles and contacts</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="min-h-11 w-full pr-10" name="q" onChange={(event) => { setSearchValue(event.currentTarget.value); setPendingSearch(true); }} placeholder="Search profiles, contacts, cities, phone, email…" style={{ paddingLeft: "3rem" }} type="search" value={searchValue} />
            {searching ? <span aria-label="Searching profiles" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-orange-700" role="status"><LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /></span> : null}
          </label>
          <label className="grid min-w-[12rem] gap-1 text-xs font-semibold text-slate-600">
            <span>Sort by</span>
            <select className="min-h-11" defaultValue={query.sort} name="sort" onChange={(event) => event.currentTarget.form?.requestSubmit()}>
              <option value="recently_updated">Recently updated</option>
              <option value="least_recently_updated">Least recently updated</option>
              <option value="name_asc">A → Z</option>
              <option value="name_desc">Z → A</option>
              <option value="created_desc">Newest profile</option>
              <option value="created_asc">Oldest profile</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Link className="button-secondary flex-1 text-center sm:flex-none" href={directoryReset}>Clear</Link>
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
            <label className="grid gap-1 text-sm font-semibold">Strategy
              <select defaultValue={query.filler} name="filler"><option value="all">All strategies</option><option value="only">Filler only</option></select>
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

        {activeFilters.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3" aria-label="Active filters">
            {activeFilters.map((filter) => (
              <Link aria-label={`Remove ${filter.label} filter`} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200" href={filter.href} key={filter.label}>
                {filter.label}<span aria-hidden className="text-slate-400">×</span>
              </Link>
            ))}
          </div>
        ) : null}
      </form>

      {afterSearch}

      <p aria-live="polite" className="text-sm text-slate-600">Showing {organizations.records.length} of {organizations.total} profiles</p>

      {organizations.records.length ? (
        <ul className="grid gap-2">
          {organizations.records.map((organization) => {
            const websiteHref = normalizeExternalWebsite(organization.website ?? null);
            const location = [organization.city, organization.region].filter(Boolean).join(", ");
            const profileHref = detailHref(organization.id, query);
            const openProfile = (event: MouseEvent<HTMLLIElement>) => {
              if ((event.target as Element).closest("a,button,input,select,textarea")) return;
              setLocation(profileHref);
            };
            const openProfileWithKeyboard = (event: KeyboardEvent<HTMLLIElement>) => {
              if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              setLocation(profileHref);
            };
            return (
              <li
                aria-label={`Open ${organization.name} profile`}
                className="cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                data-testid="profile-summary-card"
                key={organization.id}
                onClick={openProfile}
                onKeyDown={openProfileWithKeyboard}
                role="link"
                tabIndex={0}
              >
                <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[5rem_minmax(0,1fr)_9rem]">
                  <Link className="block size-20 overflow-hidden rounded-full bg-orange-50" data-testid="profile-avatar-link" href={profileHref}><ProfileAvatar image={organization.profileImageDataUrl} name={organization.name} /></Link>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link className="break-words text-xl font-bold tracking-tight text-slate-950 hover:text-orange-700" href={profileHref}>{organization.name}</Link>
                      {organization.filler ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800" title={organization.fillerReason ?? undefined}>Filler</span> : null}
                      {organization.lastResort ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800">Last Resort</span> : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-600">{location ? <span className="inline-flex items-center gap-1"><span aria-hidden>⌖</span>{location}</span> : null}</div>
                    {organization.description?.trim() ? <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-600" data-testid="profile-about-preview">{organization.description.trim()}</p> : null}
                    {organization.parentContext ? <p className="mt-1 text-xs font-semibold text-orange-700">{organization.parentContext.kind === "event_family" ? "Part of" : "Location of"} {organization.parentContext.name}</p> : null}
                    {(organization.phone || organization.email) ? <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">{organization.phone ? <Link aria-label={`Open call workspace for ${organization.phone}`} className="font-medium hover:text-orange-700" href={`/calls/workspace?organizationId=${encodeURIComponent(organization.id)}`}>{organization.phone}</Link> : null}{organization.email ? <a className="break-all font-medium hover:text-orange-700" href={`mailto:${organization.email}`}>{organization.email}</a> : null}</div> : null}
                    {websiteHref ? <a className="mt-1 block max-w-full truncate text-sm font-medium text-slate-700 hover:text-orange-700 hover:underline" href={websiteHref} rel="noreferrer" target="_blank">{organization.website}</a> : null}
                    <p className="mt-2 text-xs font-medium text-slate-500">{organization.locationCount > 0 ? `${organization.locationCount} location${organization.locationCount === 1 ? "" : "s"} · ` : ""}{organization.contactCount} contact{organization.contactCount === 1 ? "" : "s"} · {organization.bookingCount} booking{organization.bookingCount === 1 ? "" : "s"}</p>
                  </div>
                  <div className="col-start-2 self-center sm:col-start-3 sm:row-start-1"><RatingSummary average={organization.ratingAverage} count={organization.ratingCount} /></div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"><p className="font-semibold">No profiles match these filters.</p><Link className="button-secondary mt-3 inline-flex" href={directoryReset}>Clear filters</Link></div>}

      {organizations.pageCount > 1 ? <nav aria-label="Profiles pages" className="flex items-center justify-between gap-3">{organizations.page > 1 ? <Link className="button-secondary" href={listHref({ ...query, page: organizations.page - 1 })}>Previous</Link> : <span />}<p className="text-sm font-semibold text-slate-600">Page {organizations.page} of {organizations.pageCount}</p>{organizations.page < organizations.pageCount ? <Link className="button-secondary" href={listHref({ ...query, page: organizations.page + 1 })}>Next</Link> : <span />}</nav> : null}
    </div>
  );
}
