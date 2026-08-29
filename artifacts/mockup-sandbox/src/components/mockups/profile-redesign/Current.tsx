import "./_group.css";
import { useMemo, useState } from "react";
import {
  Camera, ChevronDown, Globe2, MapPin, MessageCircle, Search, UserRound,
} from "lucide-react";

type Section = "contacts" | "events" | "notes" | "emails" | null;
type Contact = { id: string; name: string; role: string; phone: string; email: string; isPrimary?: boolean };
type Activity = { id: string; body: string; kind: string; occurredAt: string };
type Profile = {
  id: string;
  place: { name: string; city: string; region: string; placeType: string; lastResort?: boolean; address1: string; postalCode: string; website: string; phone: string };
  contacts: Contact[];
  bookings: { id: string; name: string; status: string; city: string; region: string; startsAt: string }[];
  notes: Activity[];
  followUps: { kind: string; dueAt: string; completedAt?: string }[];
  familyContext?: { name: string };
};

const profile: Profile = {
  id: "profile-pine-ridge",
  place: {
    name: "Pine Ridge Adventure Lodge", city: "Estes Park", region: "CO",
    placeType: "outdoor_adventure", lastResort: false, address1: "1420 Mountain View Drive",
    postalCode: "80517", website: "pineridgeadventure.com", phone: "(970) 555-0148",
  },
  contacts: [
    { id: "contact-maya", name: "Maya Chen", role: "Guest Experience Director", phone: "(970) 555-0148", email: "maya@pineridgeadventure.com", isPrimary: true },
    { id: "contact-jon", name: "Jon Bell", role: "Events Coordinator", phone: "(970) 555-0162", email: "jon@pineridgeadventure.com" },
  ],
  bookings: [
    { id: "event-summer", name: "Summit Week 2025", status: "confirmed", city: "Estes Park", region: "CO", startsAt: "2025-07-18T16:00:00-06:00" },
    { id: "event-fall", name: "Fall Family Retreat", status: "inquiry", city: "Estes Park", region: "CO", startsAt: "2025-09-05T16:00:00-06:00" },
  ],
  notes: [
    { id: "note-1", kind: "note", body: "Maya confirmed the new trail itinerary and asked us to hold the Saturday dinner slot for the Summit Week group.", occurredAt: "2025-04-16T15:30:00-06:00" },
    { id: "note-2", kind: "call", body: "Reviewed capacity, transportation options, and the updated group deposit schedule.", occurredAt: "2025-04-08T10:15:00-06:00" },
    { id: "note-3", kind: "note", body: "Send the fall retreat proposal after the next pricing review.", occurredAt: "2025-03-28T11:00:00-06:00" },
  ],
  followUps: [{ kind: "send proposal", dueAt: "2025-05-02T09:00:00-06:00" }],
  familyContext: { name: "Colorado Mountain Partners" },
};

const dateTime = (value: string) => new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  timeZone: "America/Denver",
}).format(new Date(value));

function StatCard({ value, label, active, onClick }: { value: number; label: string; active: boolean; onClick: () => void }) {
  return (
    <button aria-expanded={active} className={`rounded-xl border px-3 py-3 text-left shadow-sm transition sm:px-4 ${active ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50"}`} onClick={onClick} type="button">
      <p className="text-xl font-bold text-slate-950 sm:text-2xl">{value}</p>
      <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-600 sm:text-sm">{label}<ChevronDown className={`h-4 w-4 transition-transform ${active ? "rotate-180" : ""}`} /></span>
    </button>
  );
}

export function Current() {
  const [openSection, setOpenSection] = useState<Section>(null);
  const [noteSearch, setNoteSearch] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [activities, setActivities] = useState(profile.notes);
  const primary = profile.contacts[0];
  const location = `${profile.place.city}, ${profile.place.region}`;
  const filtered = useMemo(() => {
    const query = noteSearch.trim().toLowerCase();
    return query ? activities.filter((item) => `${item.kind} ${item.body}`.toLowerCase().includes(query)) : activities;
  }, [activities, noteSearch]);
  const toggle = (section: Exclude<Section, null>) => setOpenSection((current) => current === section ? null : section);

  function addNote() {
    if (!noteBody.trim()) return;
    setActivities((current) => [{ id: `note-${Date.now()}`, kind: "note", body: noteBody.trim(), occurredAt: new Date().toISOString() }, ...current]);
    setNoteBody("");
    setComposerOpen(false);
  }

  return (
    <main className="profile-current min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6 lg:p-8">
      <div className="mx-auto grid max-w-6xl gap-4">
        <div className="flex flex-wrap justify-end gap-2">
          <button className="button-secondary inline-flex items-center gap-2" type="button"><MessageCircle className="h-4 w-4" /> Ask Assistant</button>
          <button className="button-secondary" type="button">Edit</button>
          <button className="button-secondary" type="button">More <ChevronDown className="ml-1 h-4 w-4" /></button>
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="relative h-28 overflow-hidden bg-gradient-to-r from-blue-900 via-blue-700 to-sky-400 sm:h-40">
            <div className="absolute -right-10 -top-16 h-56 w-56 rounded-full border-[24px] border-white/10" />
            <div className="absolute -bottom-24 left-1/3 h-56 w-56 rounded-full border-[28px] border-sky-200/20" />
            <div className="absolute bottom-3 right-4 rounded-full bg-slate-950/25 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">Adventure Zone profile</div>
          </div>
          <div className="relative px-4 sm:px-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end">
              <div className="-mt-14 shrink-0 sm:-mt-16">
                <div className="group relative block w-fit" title="Change profile photo">
                  <div className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-white bg-blue-50 text-blue-700 shadow-lg sm:h-32 sm:w-32"><UserRound className="h-12 w-12" /></div>
                  <span className="absolute bottom-1 right-1 rounded-full border border-slate-200 bg-white p-2 text-slate-700 shadow-md"><Camera className="h-4 w-4" /></span>
                </div>
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <h1 className="break-words text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{profile.place.name}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600"><span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4 text-blue-600" />{location}</span><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold capitalize text-blue-800">{profile.place.placeType.replaceAll("_", " ")}</span></div>
                <p className="mt-2 text-sm text-slate-500">Primary contact: {primary.name}</p>
              </div>
              <div className="pb-1 md:min-w-40 md:text-right"><p className="text-xl font-bold text-slate-950">4.7 <span className="text-sm font-medium text-slate-500">/ 5</span></p><p className="mt-1 text-2xl tracking-wide text-amber-500" aria-label="5 of 5 stars">★★★★★</p><p className="mt-1 text-sm text-slate-500">12 rated occurrences</p></div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-4 text-sm"><a className="font-medium text-slate-700 hover:text-blue-700" href={`tel:${profile.place.phone}`}>{profile.place.phone}</a><a className="font-medium text-slate-700 hover:text-blue-700" href={`mailto:${primary.email}`}>{primary.email}</a><a className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-blue-700" href={`https://${profile.place.website}`}><Globe2 className="h-4 w-4" />{profile.place.website}</a></div>
            <nav className="mt-4 -mx-1 flex overflow-x-auto" aria-label="Profile sections" role="tablist">
              {(["Overview", "Contacts", "Events", "Activity", "Emails"] as const).map((label) => { const section = ({ Overview: null, Contacts: "contacts", Events: "events", Activity: "notes", Emails: "emails" } as const)[label]; return <button className={`border-b-2 px-4 py-3 text-sm font-bold transition ${openSection === section ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"}`} onClick={() => setOpenSection(section)} role="tab" aria-selected={openSection === section} type="button" key={label}>{label}</button>; })}
            </nav>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,0.75fr))_minmax(0,2.2fr)]">
          <StatCard value={profile.contacts.length} label="Contacts" active={openSection === "contacts"} onClick={() => toggle("contacts")} />
          <StatCard value={profile.bookings.length} label="Events" active={openSection === "events"} onClick={() => toggle("events")} />
          <StatCard value={activities.length} label="Notes" active={openSection === "notes"} onClick={() => toggle("notes")} />
          <StatCard value={8} label="Emails" active={openSection === "emails"} onClick={() => toggle("emails")} />
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm"><p className="font-bold text-amber-900">Follow-up needed</p><p className="mt-1 text-sm capitalize text-amber-800">{profile.followUps[0].kind} · {dateTime(profile.followUps[0].dueAt)}</p></div>
        </section>

        {openSection === "contacts" && <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-bold">Contacts</h2><div className="mt-3 grid gap-2 sm:grid-cols-2">{profile.contacts.map((contact) => <div className="rounded-lg border border-slate-200 p-3" key={contact.id}><span className="font-semibold">{contact.name}</span>{contact.isPrimary && <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">Primary</span>}<p className="mt-1 text-sm text-slate-600">{contact.role} · {contact.email}</p></div>)}</div></section>}
        {openSection === "events" && <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-bold">Events</h2><div className="mt-3 grid gap-2 sm:grid-cols-2">{profile.bookings.map((booking) => <div className="rounded-lg border border-slate-200 p-3" key={booking.id}><div className="flex justify-between gap-2"><span className="font-semibold">{booking.name}</span><span className="text-xs font-semibold capitalize text-slate-500">{booking.status}</span></div><p className="mt-1 text-sm text-slate-600">{booking.city}, {booking.region}</p><p className="mt-1 text-xs text-slate-500">{dateTime(booking.startsAt)}</p></div>)}</div></section>}
        {openSection === "notes" && <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Activity history</h2><span className="text-xs text-slate-500">America/Denver</span></div><button className="button-primary" type="button" onClick={() => setComposerOpen(true)}>Add note</button></div><label className="relative mt-4 block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input aria-label="Search notes & history" className="w-full py-2 pl-9 pr-3 text-sm" placeholder="Search notes & history" value={noteSearch} onChange={(event) => setNoteSearch(event.target.value)} /></label>{composerOpen && <div className="mt-3 grid gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3"><label className="grid gap-1 text-sm font-semibold">New note<textarea className="min-h-24 px-3 py-2 font-normal" value={noteBody} onChange={(event) => setNoteBody(event.target.value)} autoFocus /></label><div className="flex gap-2"><button className="button-primary" type="button" disabled={!noteBody.trim()} onClick={addNote}>Save note</button><button className="button-secondary" type="button" onClick={() => setComposerOpen(false)}>Cancel</button></div></div>}<div className="mt-4 grid gap-3">{filtered.length ? filtered.map((activity) => <article className="border-l-2 border-blue-200 pl-3" key={activity.id}><div className="flex justify-between gap-2"><span className="text-xs font-bold uppercase text-blue-700">{activity.kind}</span><time className="text-xs text-slate-500">{dateTime(activity.occurredAt)}</time></div><p className="mt-1 text-sm leading-6 text-slate-700">{activity.body}</p></article>) : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">No notes match your search.</p>}</div></section>}
        {openSection === "emails" && <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-bold">Emails</h2><p className="mt-2 text-sm text-slate-600">8 conversations with Pine Ridge Adventure Lodge. Email history is previewed in the live application.</p></section>}

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-bold">About</h2><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3"><div><dt className="font-semibold text-slate-500">Address</dt><dd className="mt-1 whitespace-pre-line text-slate-800">{profile.place.address1}{"\n"}{profile.place.city}, {profile.place.region} {profile.place.postalCode}</dd></div><div><dt className="font-semibold text-slate-500">Category</dt><dd className="mt-1 capitalize text-slate-800">{profile.place.placeType.replaceAll("_", " ")}</dd></div><div><dt className="font-semibold text-slate-500">Group</dt><dd className="mt-1 text-slate-800">{profile.familyContext?.name}</dd></div></dl></section>
      </div>
    </main>
  );
}