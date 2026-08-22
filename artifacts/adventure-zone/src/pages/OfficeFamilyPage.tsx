import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ChevronDown, MapPin } from "lucide-react";
import { officeGet } from "@/lib/office-auth-context";

type Family = {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  members: Array<{
    id: string;
    name: string;
    city: string | null;
    region: string | null;
    contactCount: number;
    bookingCount: number;
  }>;
};

export default function OfficeFamilyPage({ familyId }: { familyId: string }) {
  const [family, setFamily] = useState<Family | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    officeGet<{ family: Family }>(`/office/event-families/${familyId}`)
      .then((data) => { if (active) setFamily(data.family); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load event family."); });
    return () => { active = false; };
  }, [familyId]);

  if (error) return <p className="rounded-xl bg-rose-50 p-4 text-rose-700" role="alert">{error}</p>;
  if (!family) return <p className="text-slate-500">Loading event family…</p>;

  return <div className="grid gap-5">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-orange-700">Event Family</p>
      <h1 className="mt-1 text-3xl font-bold">{family.name}</h1>
      <p className="mt-2 max-w-3xl text-slate-600">{family.description || `${family.memberCount} related event profiles`}</p>
      <div className="mt-4 flex flex-wrap gap-2"><span className="rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-800">{family.memberCount} event profile{family.memberCount===1?"":"s"}</span></div>
    </section>

    <details className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Family</p><h2 className="mt-1 text-xl font-bold">Event Profiles</h2><p className="mt-1 text-sm text-slate-600">Open a location to manage contacts, events, notes, brochures, and factual details.</p></div><ChevronDown className="h-5 w-5 text-slate-400 transition group-open:rotate-180"/></summary>
      <div className="mt-4 grid gap-2 border-t border-slate-100 pt-4">
        {family.members.map((member) => <Link key={member.id} href={`/office/profiles/${member.id}`} className="rounded-xl border border-slate-200 p-4 transition hover:border-orange-300 hover:bg-orange-50/40">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-lg font-bold">{member.name}</p><p className="mt-1 inline-flex items-center gap-1 text-sm text-slate-600"><MapPin className="h-4 w-4"/>{[member.city, member.region].filter(Boolean).join(", ") || "Location not set"}</p></div>
            <div className="text-right"><p className="text-xs font-semibold text-slate-500">{member.contactCount} contact{member.contactCount===1?"":"s"}</p><p className="text-xs font-semibold text-slate-500">{member.bookingCount} event{member.bookingCount===1?"":"s"}</p></div>
          </div>
        </Link>)}
      </div>
    </details>
  </div>;
}
