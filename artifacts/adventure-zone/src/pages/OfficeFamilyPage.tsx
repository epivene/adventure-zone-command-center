import { useEffect, useState } from "react";
import { Link } from "wouter";
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
    <header>
      <p className="text-sm font-bold uppercase tracking-wide text-orange-700">Event Family</p>
      <h1 className="mt-1 text-3xl font-bold">{family.name}</h1>
      <p className="mt-1 text-slate-600">{family.description || `${family.memberCount} related event profiles`}</p>
    </header>

    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="text-xl font-bold">Locations & event profiles</h2><p className="text-sm text-slate-600">Open a location to view contacts, history, bookings, mail, and factual details.</p></div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{family.memberCount}</span>
      </div>
      <div className="mt-4 grid gap-2">
        {family.members.map((member) => <Link key={member.id} href={`/office/profiles/${member.id}`} className="rounded-xl border border-slate-200 p-4 hover:border-orange-200 hover:bg-orange-50/40">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-bold">{member.name}</p><p className="text-sm text-slate-600">{[member.city, member.region].filter(Boolean).join(", ") || "Location not set"}</p></div>
            <p className="text-xs font-semibold text-slate-500">{member.contactCount} contacts · {member.bookingCount} events</p>
          </div>
        </Link>)}
      </div>
    </section>
  </div>;
}
