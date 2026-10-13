import { Link } from "wouter";
import { useLocation } from "wouter";
import { useEffect, useState, type ReactNode } from "react";
import { Download, LoaderCircle, Search } from "lucide-react";

import { profileTypeOptions } from "@/features/organizations/last-resort-input";
import type {
  OrganizationListQuery,
  OrganizationListPage,
} from "@/features/organizations/organization-repository";
import { apiFetch } from "@/lib/auth-token";
import { saveProfileReturnState } from "@/lib/profile-navigation";
import { dealModelLabels } from "@/components/profiles/profile-at-a-glance";
import { createFollowUpWorkbook } from "./follow-up-workbook";

function directoryHref(query: OrganizationListQuery, basePath: string) {
  const params = new URLSearchParams();
  if (query.directoryView && query.directoryView !== "all")
    params.set("view", query.directoryView);
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
  if (query.quickFilter) params.set("quick", query.quickFilter);
  if (query.sort !== "recently_updated") params.set("sort", query.sort);
  if (query.includeRetired) params.set("includeRetired", "true");
  if (query.page > 1) params.set("page", String(query.page));
  if (query.pageSize !== 50) params.set("pageSize", String(query.pageSize));
  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}

function profileHref(organizationId: string, query: OrganizationListQuery, basePath: string) {
  const params = new URLSearchParams({ returnTo: directoryHref(query, basePath) });
  return `${basePath}/${organizationId}?${params.toString()}`;
}

type ActiveFilter = { label: string; href: string };

function formatDate(value: Date | string | null | undefined, empty: string) {
  if (!value) return empty;
  const text = String(value);
  const date =
    value instanceof Date
      ? value
      : new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00Z` : text);
  return Number.isNaN(date.getTime())
    ? empty
    : date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
}

function readableAction(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const statusStyles = {
  deadline_soon: ["Deadline soon", "bg-accent text-accent-foreground"],
  needs_follow_up: ["Needs follow-up", "bg-accent text-accent-foreground"],
  contacted: ["Contacted", "bg-secondary text-secondary-foreground"],
  waiting: ["Waiting", "bg-muted text-muted-foreground"],
  booked: ["Booked", "bg-primary text-primary-foreground"],
  not_a_fit: ["Not a fit", "bg-destructive text-destructive-foreground"],
  unrecorded: ["Status not recorded", "bg-muted text-muted-foreground"],
} as const;

const quickFilterLabels = {
  deadline_soon: "Deadlines soon",
  pay_per_play: "Pay-per-play candidates",
  needs_follow_up: "Needs follow-up",
  booked: "Booked",
} as const;

export function OrganizationList({
  organizations,
  query,
  travelLegs,
  afterSearch,
  loading = false,
  basePath = "/profiles",
  showExports = true,
  showStrategyFilters = true,
}: {
  organizations: OrganizationListPage;
  query: OrganizationListQuery;
  travelLegs: { id: string; name: string; color: string }[];
  afterSearch?: ReactNode;
  loading?: boolean;
  basePath?: string;
  showExports?: boolean;
  showStrategyFilters?: boolean;
}) {
  const [, setLocation] = useLocation();
  const listHref = (next: OrganizationListQuery) => directoryHref(next, basePath);
  const detailHref = (id: string, next: OrganizationListQuery) => profileHref(id, next, basePath);
  const [searchValue, setSearchValue] = useState(query.search);
  const [pendingSearch, setPendingSearch] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [followUpExporting, setFollowUpExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const profileTypeLabel = profileTypeOptions.find(
    (option) => option.value === query.placeType,
  )?.label;
  const legLabel = travelLegs.find((leg) => leg.id === query.travelLegId)?.name;
  const activeFilters: ActiveFilter[] = [
    query.placeType
      ? {
          label: profileTypeLabel ?? query.placeType,
          href: listHref({ ...query, placeType: null, page: 1 }),
        }
      : null,
    query.region
      ? {
          label: `Region: ${query.region}`,
          href: listHref({ ...query, region: null, page: 1 }),
        }
      : null,
    query.lastResort === "only"
      ? {
          label: "Last Resort",
          href: listHref({ ...query, lastResort: "all", page: 1 }),
        }
      : null,
    query.filler === "only"
      ? {
          label: "Filler",
          href: listHref({ ...query, filler: "all", page: 1 }),
        }
      : null,
    query.travelLegId
      ? {
          label: `Leg: ${legLabel ?? "selected"}`,
          href: listHref({ ...query, travelLegId: null, page: 1 }),
        }
      : null,
    query.hasPhone
      ? {
          label: "Has phone",
          href: listHref({ ...query, hasPhone: false, page: 1 }),
        }
      : null,
    query.hasEmail
      ? {
          label: "Has email",
          href: listHref({ ...query, hasEmail: false, page: 1 }),
        }
      : null,
    query.hasFollowUp
      ? {
          label: "Has follow-up",
          href: listHref({ ...query, hasFollowUp: false, page: 1 }),
        }
      : null,
    query.hasBooking
      ? {
          label: "Has booking",
          href: listHref({ ...query, hasBooking: false, page: 1 }),
        }
      : null,
    query.hasLocations
      ? {
          label: "Has locations",
          href: listHref({ ...query, hasLocations: false, page: 1 }),
        }
      : null,
    query.showMembers
      ? {
          label: "Showing family members",
          href: listHref({ ...query, showMembers: false, page: 1 }),
        }
      : null,
    query.quickFilter
      ? {
          label: quickFilterLabels[query.quickFilter],
          href: listHref({ ...query, quickFilter: null, page: 1 }),
        }
      : null,
  ].filter((value): value is ActiveFilter => Boolean(value));
  const directoryReset = listHref({
    ...query,
    search: "",
    lastResort: "all",
    filler: "all",
    travelLegId: null,
    placeType: null,
    region: null,
    hasPhone: false,
    hasEmail: false,
    hasFollowUp: false,
    hasBooking: false,
    hasLocations: false,
    showMembers: false,
    quickFilter: null,
    page: 1,
  });

  useEffect(() => {
    setSearchValue(query.search);
  }, [query.search]);
  useEffect(() => {
    if (searchValue === query.search) return;
    const id = window.setTimeout(
      () =>
        setLocation(
          listHref({ ...query, search: searchValue.trim(), page: 1 }),
        ),
      150,
    );
    return () => window.clearTimeout(id);
  }, [query, query.search, searchValue, setLocation]);
  useEffect(() => {
    if (!loading && searchValue === query.search) setPendingSearch(false);
  }, [loading, query.search, searchValue]);
  const searching = pendingSearch || loading;

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const exportUrl = listHref({ ...query, page: 1 }).replace(
        /^\/profiles\??/,
        "/organizations/export?",
      );
      const response = await apiFetch(exportUrl);
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "event-profiles.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setExportError(
        cause instanceof Error
          ? cause.message
          : "The export could not be created.",
      );
    } finally {
      setExporting(false);
    }
  }

  async function exportFollowUps() {
    if (followUpExporting) return;
    setFollowUpExporting(true);
    setExportError("");
    try {
      const exportUrl = listHref({
        ...query,
        quickFilter: "needs_follow_up",
        page: 1,
      }).replace(/^\/profiles\??/, "/follow-ups/export?");
      const response = await apiFetch(exportUrl);
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const payload = (await response.json()) as {
        followUps: Parameters<typeof createFollowUpWorkbook>[0];
      };
      const workbook = createFollowUpWorkbook(
        payload.followUps,
        new Date(),
      );
      const workbookBytes = workbook.data.buffer.slice(
        workbook.data.byteOffset,
        workbook.data.byteOffset + workbook.data.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([workbookBytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = workbook.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setExportError(
        cause instanceof Error
          ? cause.message
          : "The follow-up export could not be created.",
      );
    } finally {
      setFollowUpExporting(false);
    }
  }

  return (
    <div className="grid gap-4">
      <form
        action={basePath}
        className="rounded-xl border border-border bg-card p-3 shadow-sm"
        method="get"
      >
        {query.directoryView && query.directoryView !== "all" ? (
          <input name="view" type="hidden" value={query.directoryView} />
        ) : null}
        {query.quickFilter ? (
          <input name="quick" type="hidden" value={query.quickFilter} />
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Search profiles</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="min-h-11 w-full pr-10"
              aria-label="Search profiles"
              name="q"
              onChange={(event) => {
                setSearchValue(event.currentTarget.value);
                setPendingSearch(true);
              }}
              placeholder="Search profiles, contacts, cities, phone, email…"
              style={{ paddingLeft: "3rem" }}
              type="search"
              value={searchValue}
            />
            {searching ? (
              <span
                aria-label="Searching profiles"
                className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-orange-700"
                role="status"
              >
                <LoaderCircle
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin"
                />
              </span>
            ) : null}
          </label>
          <label className="grid min-w-[12rem] gap-1 text-xs font-semibold text-muted-foreground">
            <span>Sort by</span>
            <select
              className="min-h-11"
              defaultValue={query.sort}
              name="sort"
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              <option value="recently_updated">Recently updated</option>
              <option value="least_recently_updated">
                Least recently updated
              </option>
              <option value="name_asc">A → Z</option>
              <option value="name_desc">Z → A</option>
              <option value="created_desc">Newest profile</option>
              <option value="created_asc">Oldest profile</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            {showExports ? <>
            <button
              className="button-primary inline-flex flex-1 items-center justify-center gap-2 sm:flex-none"
              disabled={followUpExporting}
              onClick={() => void exportFollowUps()}
              type="button"
            >
              <Download aria-hidden className="h-4 w-4" />
              {followUpExporting ? "Exporting…" : "Export Follow-ups"}
            </button>
            <button
              className="button-secondary inline-flex flex-1 items-center justify-center gap-2 sm:flex-none"
              disabled={exporting}
              onClick={() => void exportCsv()}
              type="button"
            >
              <Download aria-hidden className="h-4 w-4" />
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
            </> : null}
            <Link
              className="button-secondary flex-1 text-center sm:flex-none"
              href={directoryReset}
            >
              Clear
            </Link>
          </div>
        </div>

        <details className="group mt-2">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-sm font-semibold text-foreground hover:bg-muted">
            <span>Filters</span>
            {activeFilters.length ? (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-800">
                {activeFilters.length}
              </span>
            ) : null}
            <span className="ml-auto text-muted-foreground transition group-open:rotate-180">
              ⌄
            </span>
          </summary>

          <div className="mt-2 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="grid gap-1 text-sm font-semibold">
              Profile type
              <select defaultValue={query.placeType ?? ""} name="type">
                <option value="">All profile types</option>
                {profileTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              State / region
              <input
                defaultValue={query.region ?? ""}
                name="region"
                placeholder="Colorado or CO"
              />
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
            {showStrategyFilters ? <>
            <label className="grid gap-1 text-sm font-semibold">
              Profile status
              <select defaultValue={query.lastResort} name="lastResort">
                <option value="all">All profiles</option>
                <option value="only">Last Resort only</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Strategy
              <select defaultValue={query.filler} name="filler">
                <option value="all">All strategies</option>
                <option value="only">Filler only</option>
              </select>
            </label>
            </> : null}
            <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-2">
              {[
                ["hasPhone", query.hasPhone, "Has phone"],
                ["hasEmail", query.hasEmail, "Has email"],
                ["hasFollowUp", query.hasFollowUp, "Has follow-up"],
                ["hasBooking", query.hasBooking, "Has booking"],
                ["hasLocations", query.hasLocations, "Has locations"],
                ["showMembers", query.showMembers, "Show family members"],
              ].map(([name, checked, label]) => (
                <label
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  key={String(name)}
                >
                  <input
                    defaultChecked={Boolean(checked)}
                    name={String(name)}
                    type="checkbox"
                    value="yes"
                  />
                  {String(label)}
                </label>
              ))}
            </div>
            <div className="flex items-end">
              <button className="button-secondary w-full" type="submit">
                Apply filters
              </button>
            </div>
          </div>
        </details>

        {activeFilters.length ? (
          <div
            className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3"
            aria-label="Active filters"
          >
            {activeFilters.map((filter) => (
              <Link
                aria-label={`Remove ${filter.label} filter`}
                className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-secondary/80"
                href={filter.href}
                key={filter.label}
              >
                {filter.label}
                <span aria-hidden className="text-muted-foreground">
                  ×
                </span>
              </Link>
            ))}
          </div>
        ) : null}
      </form>

      {exportError ? (
        <p
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800"
          role="alert"
        >
          {exportError}
        </p>
      ) : null}

      <nav aria-label="Profile quick filters" className="flex flex-wrap gap-2">
        {(
          [
            ["deadline_soon", "Deadlines soon"],
            ["pay_per_play", "Pay-per-play candidates"],
            ["needs_follow_up", "Needs follow-up"],
            ["booked", "Booked"],
          ] as const
        ).map(([value, label]) => {
          const active = query.quickFilter === value;
          return (
            <Link
              aria-current={active ? "true" : undefined}
              className={`shrink-0 rounded-full border px-3 py-2 text-sm font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2 ${active ? "border-orange-700 bg-orange-700 text-white" : "border-border bg-card text-foreground hover:border-orange-400"}`}
              href={listHref({
                ...query,
                quickFilter: active ? null : value,
                page: 1,
              })}
              key={value}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {afterSearch}

      <section
        className="overflow-hidden rounded-md border border-border bg-muted"
        data-testid="profile-list-workspace"
      >
        <div className="grid content-start gap-3 p-3 lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto lg:border-r lg:border-border lg:p-4">
          <p aria-live="polite" className="text-sm text-muted-foreground">
            Showing {organizations.records.length} of {organizations.total}{" "}
            profiles
          </p>

          {organizations.records.length ? (
            <ul className="grid gap-2">
              {organizations.records.map((organization) => {
                const location = [organization.city, organization.region]
                  .filter(Boolean)
                  .join(", ");
                const profileHref = detailHref(organization.id, query);
                const status =
                  statusStyles[organization.decisionStatus ?? "unrecorded"];
                const ratingCount = organization.ratingCount ?? 0;
                const rating = organization.ratingAverage ?? null;
                const roundedRating = rating === null ? 0 : Math.round(rating);
                return (
                  <li key={organization.id}>
                    <Link
                      aria-label={`Open ${organization.name} profile`}
                      className="group block rounded-md border border-border bg-card p-4 text-left shadow-sm transition hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid={`profile-card-${organization.id}`}
                      href={profileHref}
                      onClick={(event) => {
                        if (
                          !event.metaKey &&
                          !event.ctrlKey &&
                          !event.shiftKey &&
                          event.button === 0
                        ) {
                          saveProfileReturnState(window.location.pathname + window.location.search, window.scrollY);
                        }
                      }}
                    >
                      <span
                        className="grid min-w-0 gap-3 md:grid-cols-3"
                        data-testid="profile-decision-summary"
                      >
                        <span className="min-w-0">
                          <span className="block break-words text-xl font-extrabold leading-tight tracking-tight text-foreground group-hover:text-primary">
                            {organization.name}
                          </span>
                          <span className="mt-1 block text-xs font-medium text-muted-foreground">
                            {location || "Location not recorded"}
                          </span>
                          <span
                            aria-label={
                              rating === null
                                ? "No reviews"
                                : `${rating.toFixed(1)} out of 5 stars from ${ratingCount} reviews`
                            }
                            className="mt-1.5 block text-xs font-semibold text-muted-foreground"
                            data-testid="profile-rating-summary"
                          >
                            {rating === null ? (
                              "No reviews"
                            ) : (
                              <>
                                <span aria-hidden className="text-accent">
                                  {"★".repeat(roundedRating)}
                                  {"☆".repeat(5 - roundedRating)}
                                </span>{" "}
                                {rating.toFixed(1)} ({ratingCount})
                              </>
                            )}
                          </span>
                          {organization.description?.trim() ? (
                            <span
                              className="mt-2 block line-clamp-2 text-sm leading-5 text-muted-foreground"
                              data-testid="profile-about-preview"
                            >
                              {organization.description.trim()}
                            </span>
                          ) : null}
                        </span>

                        <span
                          className="grid content-start gap-1 border-t border-border pt-3 text-sm md:border-l md:border-t-0 md:pl-4 md:pt-0"
                          data-testid="profile-money-line"
                        >
                          <span className="text-xs font-semibold text-muted-foreground">
                            Most recent event
                          </span>
                          <strong
                            className="text-foreground"
                            data-testid="profile-date-summary"
                          >
                            {organization.latestRecordedEventDate
                              ? `Latest event ${formatDate(organization.latestRecordedEventDate.startsOn, "")}${organization.latestRecordedEventDate.endsOn ? `–${formatDate(organization.latestRecordedEventDate.endsOn, "")}` : ""}`
                              : "No event date recorded"}
                          </strong>
                          <span className="mt-2 text-xs font-semibold text-muted-foreground">
                            Deal recommendation
                          </span>
                          <strong className="text-sm text-foreground">
                            {organization.recommendedDealModel
                              ? dealModelLabels[
                                  organization.recommendedDealModel
                                ]
                              : "No deal recommendation"}
                          </strong>
                        </span>

                        <span className="grid content-start gap-2 border-t border-border pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-muted-foreground">
                              Outreach status
                            </span>
                            <span
                              className={`shrink-0 rounded-sm px-2 py-1 text-xs font-extrabold uppercase ${status[1]}`}
                            >
                              {status[0]}
                            </span>
                          </span>
                          <span className="grid gap-1">
                            <span className="text-xs font-semibold text-muted-foreground">
                              Next action
                            </span>
                            <strong
                              className="text-sm text-foreground"
                              data-testid="profile-next-action"
                            >
                              {organization.nextActionKind
                                ? readableAction(
                                    String(organization.nextActionKind),
                                  )
                                : "No next action recorded"}
                            </strong>
                            {organization.nextActionDueAt ? (
                              <span className="text-xs text-muted-foreground">
                                Due{" "}
                                {formatDate(organization.nextActionDueAt, "")}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-card p-8 text-center">
              <p className="font-semibold">No profiles match these filters.</p>
              <Link
                className="button-secondary mt-3 inline-flex"
                href={directoryReset}
              >
                Clear filters
              </Link>
            </div>
          )}

          {organizations.pageCount > 1 ? (
            <nav
              aria-label="Profiles pages"
              className="flex items-center justify-between gap-3"
            >
              {organizations.page > 1 ? (
                <Link
                  className="button-secondary"
                  href={listHref({ ...query, page: organizations.page - 1 })}
                >
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <p className="text-sm font-semibold text-muted-foreground">
                Page {organizations.page} of {organizations.pageCount}
              </p>
              {organizations.page < organizations.pageCount ? (
                <Link
                  className="button-secondary"
                  href={listHref({ ...query, page: organizations.page + 1 })}
                >
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </div>
      </section>
    </div>
  );
}
