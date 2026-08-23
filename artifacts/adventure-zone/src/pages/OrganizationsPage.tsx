import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { Link, useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { OrganizationList } from "@/components/organizations/organization-list";
import { DuplicatesView, type DuplicateGroup } from "@/components/organizations/duplicates-view";
import { organizationListQuerySchema } from "@/features/organizations/last-resort-input";
import { hideRetiredProfileResults } from "@/features/organizations/hide-retired-profile-results";
import { EventFamilySuggestions } from "@/components/event-families/event-family-suggestions";
import { EventFamilyCard } from "@/components/event-families/event-family-card";
import { ManualEventFamilyDialog } from "@/components/event-families/manual-event-family-dialog";
import { ProfileDetailSheet, type ProfileSheetTarget } from "@/components/profiles/profile-detail-sheet";
import { ContactDirectoryView } from "@/components/profiles/contact-directory-view";
import { AssistantTransientContext } from "@/components/assistant/assistant-transient-context";

type LabeledProfileSheetTarget = ProfileSheetTarget & { label?: string };
type ProfileDirectoryView = "profiles" | "contacts";

function directoryView(value: string | null): ProfileDirectoryView {
  return value === "contacts" ? "contacts" : "profiles";
}

export default function OrganizationsPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const view = directoryView(params.get("view"));
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
    includeRetired: params.get("includeRetired") ?? undefined,
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
  });

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(view !== "contacts");
  const [error, setError] = useState<string | null>(null);
  const [profileTarget, setProfileTarget] = useState<LabeledProfileSheetTarget | null>(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupError, setDupError] = useState<string | null>(null);
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[] | null>(null);
  const [eventFamilyOpen, setEventFamilyOpen] = useState(false);

  const loadProfiles = useCallback(async () => {
    if (view === "contacts") {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
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
    if (query.includeRetired) qs.set("includeRetired", "true");
    if (query.page > 1) qs.set("page", String(query.page));
    if (query.pageSize !== 50) qs.set("pageSize", String(query.pageSize));

    setLoading(true);
    setError(null);
    try {
      setData(await apiGet<any>(`/organizations?${qs.toString()}`));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load profiles");
    } finally {
      setLoading(false);
    }
  }, [view, query.search, query.lastResort, query.travelLegId, query.placeType, query.region, query.hasPhone, query.hasEmail, query.hasFollowUp, query.hasBooking, query.hasLocations, query.showMembers, query.includeRetired, query.page, query.pageSize]);

  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  const loadDuplicates = useCallback(async () => {
    setDupLoading(true);
    setDupError(null);
    try {
      const result = await apiGet<{ groups: DuplicateGroup[] }>("/organizations/duplicates");
      setDupGroups(result.groups);
      return result.groups;
    } catch (e: any) {
      setDupError(e.message ?? "Failed to load duplicates");
      return null;
    } finally { setDupLoading(false); }
  }, []);

  function handleProfileLink(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const element = event.target instanceof Element ? event.target.closest("a[href]") : null;
    const href = element?.getAttribute("href") ?? "";
    const match = href.match(/^\/profiles\/([^/?#]+)/);
    if (!match?.[1]) return;
    event.preventDefault();
    const queryString = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
    const linkParams = new URLSearchParams(queryString);
    setProfileTarget({
      profileId: decodeURIComponent(match[1]),
      contactId: linkParams.get("contactId") ?? undefined,
      label: element?.textContent?.trim() || "Side profile",
    });
  }

  function openDuplicates() {
    setShowDuplicates(true);
    void loadDuplicates();
  }

  function closeDuplicates() {
    setShowDuplicates(false);
    setDupGroups(null);
  }

  function viewHref(next: ProfileDirectoryView) {
    const nextParams = new URLSearchParams();
    if (next === "contacts") nextParams.set("view", "contacts");
    if (query.search) nextParams.set("q", query.search);
    const suffix = nextParams.toString();
    return suffix ? `/profiles?${suffix}` : "/profiles";
  }

  const families = data?.families ?? [];
  const organizationPage = hideRetiredProfileResults(
    data?.organizations ?? data ?? { records: [] },
    query.includeRetired || query.showMembers,
  );
  const familySection = view === "profiles" && !showDuplicates && families.length > 0 ? (
    <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer font-bold">Event Families <span className="ml-1 text-sm font-normal text-slate-500">({families.length})</span></summary>
      <p className="mt-1 text-sm text-slate-600">Open a family to manage its related event profiles.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{families.map((family: any) => <EventFamilyCard key={family.id} family={family} />)}</div>
    </details>
  ) : null;

  return (
    <div className="mx-auto grid max-w-7xl gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Relationships</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Profiles</h1>
          {!showDuplicates ? <p className="mt-2 max-w-2xl text-slate-600">Events, fairs, companies, venues, schools, cities, and other places all live together as profiles.</p> : null}
        </div>
        {!showDuplicates && view === "profiles" ? <button className="button-primary" onClick={() => setEventFamilyOpen(true)} type="button">+ Event Family</button> : view === "contacts" ? <Link className="button-primary" href="/contacts/new">+ Contact</Link> : null}
      </header>

      {!showDuplicates ? (
        <nav aria-label="Profile directory views" className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          {(["profiles", "contacts"] as ProfileDirectoryView[]).map((item) => {
            const label = item === "profiles" ? "Profiles" : "Contacts";
            return <Link className={view === item ? "rounded-lg bg-orange-100 px-3 py-2 text-sm font-bold text-orange-900" : "rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"} href={viewHref(item)} key={item}>{label}</Link>;
          })}
        </nav>
      ) : null}

      {showDuplicates ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3"><h2 className="text-lg font-semibold">Duplicate place profiles</h2>{dupGroups !== null && !dupLoading ? <span className="rounded-full bg-amber-100 px-3 py-0.5 text-sm font-bold text-amber-800">{dupGroups.length} group{dupGroups.length !== 1 ? "s" : ""}</span> : null}</div>
            <button className="button-secondary" onClick={closeDuplicates}>← Back to profiles</button>
          </div>
          {dupLoading && dupGroups === null ? <p className="text-slate-500">Scanning for duplicates…</p> : dupGroups !== null ? <>{dupError ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">Could not refresh duplicate status: {dupError}</p><button className="button-secondary mt-3" onClick={() => void loadDuplicates()}>Retry status refresh</button></div> : null}<DuplicatesView groups={dupGroups} onRefresh={loadDuplicates} /></> : dupError ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">{dupError}</p><button className="button-secondary mt-3" onClick={() => void loadDuplicates()}>Retry</button></div> : null}
        </div>
      ) : view === "contacts" ? (
        <ContactDirectoryView search={search} basePath="/profiles" fixedParams={{ view: "contacts" }} />
      ) : (
        <div onClickCapture={handleProfileLink}>
          {loading ? <p className="text-slate-500">Loading profiles…</p> : error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">{error}</p></div> : data ? <OrganizationList organizations={organizationPage} query={query} travelLegs={data.travelLegs ?? []} afterSearch={familySection} /> : null}
          <section className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3" aria-label="Profile utilities">
            <div className="flex flex-wrap items-center gap-2">
              <EventFamilySuggestions compact onChanged={loadProfiles} />
              <button className="button-secondary text-sm" onClick={openDuplicates} type="button">Find duplicates</button>
            </div>
          </section>
        </div>
      )}

      <ManualEventFamilyDialog onChanged={loadProfiles} onOpenChange={setEventFamilyOpen} open={eventFamilyOpen} />
      {profileTarget?.profileId ? <AssistantTransientContext open kind="organization" recordId={profileTarget.profileId} label={profileTarget.label ?? "Side profile"} /> : null}
      <ProfileDetailSheet open={Boolean(profileTarget)} onOpenChange={(open) => { if (!open) setProfileTarget(null); }} target={profileTarget} />
    </div>
  );
}
