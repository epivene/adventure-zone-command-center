import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { MapPin } from "lucide-react";
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
      <h1 className="text-3xl font-bold">Event Profiles</h1>
      <p className="mt-1 text-slate-600">{q ? `Results for “${q}”` : "Event families and individual locations, all in one place."}</p>
    </header>
    {error ? <p className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</p> : null}
    {data ? <>
      {data.families.length ? <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-bold">Event Families <span className="ml-1 text-sm font-normal text-slate-500">({data.families.length})</span></summary>
        <p className="mt-1 text-sm text-slate-600">Open a family to see its related event profiles and locations.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {data.families.map((family) => <Link key={family.id} href={`/office/profiles?familyId=${family.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="rounded-xl border border-slate-200 p-4 transition hover:border-orange-300 hover:bg-orange-50/50">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-lg font-bold text-slate-950">{family.name}</h3>{family.description ? <p className="mt-1 line-clamp-2 text-sm text-slate-600">{family.description}</p> : <p className="mt-1 text-sm text-slate-500">Event family profile</p>}</div><span className="min-w-max rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{family.memberCount} location{family.memberCount===1?"":"s"}</span></div>
          </Link>)}
        </div>
      </details> : null}

      <div className="flex items-center justify-between gap-3"><p className="text-sm text-slate-600">Showing {data.records.length} of {data.total} profiles</p><p className="text-xs font-semibold text-slate-400">12 per page</p></div>
      {data.records.length ? <div className="grid gap-2">
        {data.records.map((profile) => {
          const location=[profile.city,profile.region].filter(Boolean).join(", ");
          return <Link key={profile.id} href={`/office/profiles/${profile.id}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-orange-300 hover:shadow-md">
            <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[5rem_minmax(0,1fr)_auto]">
              <div className="min-w-0"><h2 className="break-words text-xl font-bold tracking-tight text-slate-950">{profile.name}</h2><div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">{location?<span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4"/>{location}</span>:<span>Location not set</span>}{profile.primaryContactName?<span>· {profile.primaryContactName}</span>:null}</div><p className="mt-2 text-xs font-medium text-slate-500">{profile.locationCount>0?`${profile.locationCount} location${profile.locationCount===1?"":"s"} · `:""}{profile.contactCount} contact{profile.contactCount===1?"":"s"} · {profile.bookingCount} event{profile.bookingCount===1?"":"s"}</p></div>
              <span className="col-start-2 text-sm font-semibold text-orange-700 sm:col-start-3">Open profile →</span>
            </div>
          </Link>;
        })}
      </div>:<div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"><p className="font-semibold">No profiles match this search.</p><Link className="button-secondary mt-3 inline-flex" href="/office/profiles">Clear search</Link></div>}
      {data.pageCount > 1 ? <nav aria-label="Office profile pages" className="flex items-center justify-between gap-3">{data.page > 1 ? <Link className="button-secondary" href={href(data.page - 1)}>Previous</Link> : <span />}<span className="text-sm font-semibold text-slate-500">Page {data.page} of {data.pageCount}</span>{data.page < data.pageCount ? <Link className="button-secondary" href={href(data.page + 1)}>Next</Link> : <span />}</nav> : null}
    </> : <p className="text-slate-500">Loading profiles…</p>}
  </div>;
}
