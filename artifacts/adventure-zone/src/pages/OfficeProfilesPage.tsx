import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { officeGet } from "@/lib/office-auth-context";
import OfficeFamilyPage from "@/pages/OfficeFamilyPage";

type Record = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  primaryContactName: string | null;
  contactCount: number;
  bookingCount: number;
  locationCount: number;
};
type Family = { id: string; name: string; description: string | null; memberCount: number; matchedMemberCount: number };
type Page = { records: Record[]; families: Family[]; total: number; page: number; pageCount: number };

export default function OfficeProfilesPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const q = params.get("q") ?? "";
  const familyId = params.get("familyId");
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (familyId) return;
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (page > 1) qs.set("page", String(page));
    officeGet<Page>(`/office/profiles?${qs}`)
      .then((next) => { setData(next); setError(""); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load profiles."));
  }, [q, page, familyId]);

  function href(next: number) {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (next > 1) p.set("page", String(next));
    return `/office/profiles${p.toString() ? `?${p}` : ""}`;
  }

  if (familyId) {
    const back = q ? `/office/profiles?q=${encodeURIComponent(q)}` : "/office/profiles";
    return <div className="grid gap-4"><div><Link className="text-sm font-semibold text-orange-700" href={back}>← Back to Profiles</Link></div><OfficeFamilyPage familyId={familyId} /></div>;
  }

  return <div className="grid gap-5">
    <header>
      <p className="text-sm font-bold uppercase tracking-wide text-orange-700">Profiles</p>
      <h1 className="text-3xl font-bold">Event & contact profiles</h1>
      <p className="mt-1 text-slate-600">{q ? `Results for “${q}”` : "Search from the bar above or browse the current profiles."}</p>
    </header>
    {error ? <p className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</p> : null}
    {data ? <>
      {data.families.length ? <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold">Event Families</h2>
        <p className="mt-1 text-sm text-slate-600">Related locations are grouped together here, the same way they are in the main Profiles area.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {data.families.map((family) => <Link key={family.id} href={`/office/profiles?familyId=${family.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="rounded-xl border border-slate-200 p-4 hover:border-orange-200 hover:bg-orange-50/40">
            <div className="flex items-start justify-between gap-2"><div><h3 className="font-bold">{family.name}</h3>{family.description ? <p className="mt-1 text-sm text-slate-600">{family.description}</p> : null}</div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{family.memberCount} locations</span></div>
          </Link>)}
        </div>
      </section> : null}
      <p className="text-sm text-slate-600">Showing {data.records.length} individual profiles on this page</p>
      <div className="grid gap-2">{data.records.map((profile) => <Link key={profile.id} href={`/office/profiles/${profile.id}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-orange-200"><div className="flex flex-wrap justify-between gap-2"><div><h2 className="text-lg font-bold">{profile.name}</h2><p className="text-sm text-slate-600">{[profile.city, profile.region].filter(Boolean).join(", ") || "Location not set"}{profile.primaryContactName ? ` · ${profile.primaryContactName}` : ""}</p></div><p className="text-xs font-semibold text-slate-500">{profile.contactCount} contacts · {profile.bookingCount} events · {profile.locationCount} locations</p></div></Link>)}</div>
      {data.pageCount > 1 ? <div className="flex justify-between">{data.page > 1 ? <Link className="button-secondary" href={href(data.page - 1)}>Previous</Link> : <span />}<span className="text-sm font-semibold text-slate-500">Page {data.page} of {data.pageCount}</span>{data.page < data.pageCount ? <Link className="button-secondary" href={href(data.page + 1)}>Next</Link> : <span />}</div> : null}
    </> : <p className="text-slate-500">Loading profiles…</p>}
  </div>;
}
