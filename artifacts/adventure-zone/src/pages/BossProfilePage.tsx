import { useCallback, useEffect, useState, type ReactNode, type ComponentProps } from "react";
import { Link, useSearch } from "wouter";
import { ArrowLeft, ArrowUpRight, Building2, CalendarDays, Check, Clock3, ExternalLink, Mail, MapPin, Phone, StickyNote, UserRound, UsersRound } from "lucide-react";
import { bossGet, bossPatch } from "@/lib/boss-auth-context";
import { OfficeProfileEditor } from "@/components/office/office-profile-editor";
import { BossProfileEmails, getBossProfileEmails } from "@/components/boss/boss-profile-emails";
import { ConventionHistory } from "@/components/profiles/convention-history";
import { ProfileAtAGlance } from "@/components/profiles/profile-at-a-glance";
import { useProfileGoogleEmail } from "@/components/google-workspace/use-profile-google-email";

type Contact = { id: string; name: string; role: string | null; jobTitle: string | null; isPrimary: boolean; phone: string | null; email: string | null; locationName: string | null };
type Booking = { id: string; name: string; city: string; region: string; startsAt: string | null; endsAt: string | null; status: string };
type Note = { id: string; kind: string; body: string; occurredAt: string };
type Location = { id: string; label: string; venueName: string | null; address1: string | null; address2: string | null; city: string | null; region: string | null; postalCode: string | null; website: string | null; phone: string | null; email: string | null };
type Profile = {
  id: string; name: string; description: string | null; phone: string | null;
  address1: string | null; address2: string | null; city: string | null; region: string | null; postalCode: string | null; website: string | null;
  atAGlance?: Omit<ComponentProps<typeof ProfileAtAGlance>["profile"], "contacts" | "bookings" | "notes">;
  contacts: Contact[]; bookings: Booking[]; notes: Note[]; locations: Location[];
};
type OpenSection = "contacts" | "events" | "emails" | "notes" | null;

function address(values: Array<string | null | undefined>) {
  return values.filter(Boolean).join(", ");
}

function displayDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "AZ";
}

function StatCard({ icon, value, label, active, onClick }: { icon: ReactNode; value: number; label: string; active: boolean; onClick: () => void }) {
  return (
    <button aria-expanded={active} className={`group rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-ring ${active ? "border-primary/30 bg-secondary" : "border-border bg-card hover:border-primary/30 hover:bg-secondary/60"}`} onClick={onClick} type="button">
      <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary">{icon}</span>
      <span className="block text-2xl font-bold tracking-tight text-foreground">{value}</span>
      <span className="mt-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}<ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" /></span>
    </button>
  );
}

export default function BossProfilePage({ profileId }: { profileId: string }) {
  const search = useSearch();
  const requestedReturn = new URLSearchParams(search).get("returnTo") ?? "";
  const returnTo = /^\/boss\/(profiles|contacts)(\?|$)/.test(requestedReturn) && !/[\\\r\n]/.test(requestedReturn) ? requestedReturn : "/boss/profiles";
  const gmail = useProfileGoogleEmail(profileId, undefined, getBossProfileEmails);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [openSection, setOpenSection] = useState<OpenSection>(null);


  const load = useCallback(async () => {
    try {
      const result = await bossGet<{ profile: Profile }>(`/boss/profiles/${profileId}`);
      setProfile(result.profile);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load profile.");
    }
  }, [profileId]);

  useEffect(() => {
    setProfile(null);
    setEditing(false);
    setOpenSection(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (new URLSearchParams(search).get("section") === "emails") setOpenSection("emails");
  }, [search]);

  if (error) return <p className="rounded-xl bg-destructive/10 p-4 text-destructive" role="alert">{error}</p>;
  if (!profile) return <p className="text-sm text-muted-foreground">Loading profile…</p>;

  const primaryContact = profile.contacts.find((contact) => contact.isPrimary) ?? profile.contacts[0] ?? null;
  const fullAddress = address([profile.address1, profile.address2, profile.city, profile.region, profile.postalCode]);
  const shortLocation = address([profile.city, profile.region]);
  const website = profile.website && /^https?:\/\//i.test(profile.website) ? profile.website : profile.website ? `https://${profile.website}` : null;
  const recentNotes = [...profile.notes].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  const toggle = (section: Exclude<OpenSection, null>) => setOpenSection((current) => current === section ? null : section);

  return (
    <div className="profile-modern min-w-0 break-words -mx-3 -my-4 min-h-[100dvh] bg-background px-3 py-4 text-foreground md:-mx-8 md:-my-6 md:px-8 md:py-6" data-testid="boss-profile-page">
      <div className="mx-auto grid min-w-0 w-full max-w-[1420px] grid-cols-[minmax(0,1fr)] gap-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">AZ</div>
            <div><p className="font-bold tracking-tight">Adventure Zone</p><p className="text-xs text-muted-foreground">Relationships / Profiles</p></div>
          </div>
          {primaryContact ? <Link className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-muted-foreground" href={`/boss/contacts/${primaryContact.id}`}><UserRound className="h-4 w-4" />{primaryContact.name}</Link> : null}
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground" href={returnTo}><ArrowLeft className="h-3.5 w-3.5" /> Profiles</Link>
          <button className="button-secondary !border-border !bg-card !text-foreground" onClick={() => setEditing((value) => !value)} type="button">{editing ? "Close Edit" : "Edit Profile"}</button>
        </div>

        {editing ? <OfficeProfileEditor profile={profile} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await load(); }} saveProfile={(id, input) => bossPatch(`/boss/profiles/${id}`, input)} /> : (
          <>
            <section className="rounded-2xl border border-border bg-card shadow-[0_12px_32px_rgba(32,71,77,0.06)]">
              <div className="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border bg-secondary sm:h-20 sm:w-20">
                    <div className="flex h-full w-full items-center justify-center text-lg font-bold text-primary">{initials(profile.name)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h1 className="break-words text-2xl font-bold tracking-[-0.03em] sm:text-3xl">{profile.name}</h1><span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-primary">Active relationship</span></div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                      {shortLocation ? <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-primary" />{shortLocation}</span> : null}
                      <span className="inline-flex items-center gap-1.5"><Building2 className="h-4 w-4 text-primary" />Organization</span>
                      <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" />Profile details</span>
                    </div>
                    {website ? <a className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary" href={website} rel="noreferrer noopener" target="_blank"><ExternalLink className="h-3.5 w-3.5" />Visit website</a> : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {(primaryContact?.phone ?? profile.phone) ? <a className="button-secondary inline-flex items-center gap-2 !border-border !bg-transparent !text-foreground" href={`tel:${primaryContact?.phone ?? profile.phone}`}><Phone className="h-4 w-4" />Call</a> : null}
                  {primaryContact?.email ? <a className="button-primary inline-flex items-center gap-2" href={`mailto:${primaryContact.email}`}><Mail className="h-4 w-4" />Email</a> : null}
                </div>
              </div>
              {profile.description?.trim() ? <div className="border-t border-border px-5 py-4 sm:px-7"><h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">About</h2><p className="mt-2 whitespace-pre-line text-sm leading-6 text-foreground">{profile.description.trim()}</p></div> : null}
              <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-7">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Organization record</p><p className="mt-2 text-xs leading-5 text-foreground">{fullAddress || "Address not recorded"}</p></div>
                <span className="hidden items-center gap-1.5 pt-1 text-xs font-semibold text-muted-foreground md:inline-flex"><Clock3 className="h-3.5 w-3.5" />Mountain Time (MT)</span>
              </div>
            </section>

            <ProfileAtAGlance allowDateManagement={false} profile={{
              place: { name: profile.name }, ...profile.atAGlance,
              contacts: profile.contacts, bookings: profile.bookings, notes: profile.notes,
            }} />

            <section className="grid gap-3 sm:grid-cols-3">
              <StatCard active={openSection === "contacts"} icon={<UsersRound className="h-4 w-4" />} label="Contacts" onClick={() => toggle("contacts")} value={profile.contacts.length} />
              <StatCard active={openSection === "events"} icon={<CalendarDays className="h-4 w-4" />} label="Bookings" onClick={() => toggle("events")} value={profile.bookings.length} />
              <StatCard active={openSection === "emails"} icon={<Mail className="h-4 w-4" />} label="Emails" onClick={() => toggle("emails")} value={gmail.conversations.length} />
            </section>

            {openSection === null ? <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,0.85fr)]">
              <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Relationship activity</p><h2 className="mt-1 text-xl font-bold">Recent history</h2></div><button className="inline-flex items-center gap-1.5 text-sm font-bold text-primary" onClick={() => setOpenSection("notes")} type="button">View all <ArrowUpRight className="h-4 w-4" /></button></div>
                <div className="mt-5 grid gap-4">{recentNotes.slice(0, 3).length ? recentNotes.slice(0, 3).map((note) => <article className="flex gap-3" key={note.id}><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary"><StickyNote className="h-4 w-4" /></span><div className="min-w-0 flex-1 border-b border-border pb-4"><div className="flex flex-wrap justify-between gap-2"><p className="text-xs font-bold uppercase text-muted-foreground">{note.kind}</p><time className="text-xs text-muted-foreground">{displayDate(note.occurredAt)}</time></div><p className="mt-1 text-sm leading-6 text-foreground">{note.body}</p></div></article>) : <p className="text-sm text-muted-foreground">No relationship activity has been recorded yet.</p>}</div>
              </section>
              <BossProfileEmails key={profile.id} organizationId={profile.id} state={gmail} compact onViewAll={() => setOpenSection("emails")} />
            </div> : null}

            {openSection === "contacts" ? <section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><h2 className="text-xl font-bold">Contacts</h2><div className="mt-5 grid gap-3 md:grid-cols-2">{profile.contacts.length ? profile.contacts.map((contact) => <article className="rounded-xl border border-border bg-muted p-4" key={contact.id}><Link className="flex min-w-0 items-center gap-3" href={`/boss/contacts/${contact.id}`}><span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-xs font-bold text-primary">{initials(contact.name)}</span><span><span className="block font-bold">{contact.name}</span><span className="block text-sm text-muted-foreground">{contact.role || contact.jobTitle || "Contact"}</span></span></Link><div className="mt-3 flex flex-wrap gap-3 text-sm">{contact.phone ? <a href={`tel:${contact.phone}`}>{contact.phone}</a> : null}{contact.email ? <a className="text-primary" href={`mailto:${contact.email}`}>{contact.email}</a> : null}</div></article>) : <p className="text-sm text-muted-foreground">No contacts are linked.</p>}</div></section> : null}
            {openSection === "events" ? <section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><h2 className="text-xl font-bold">Bookings</h2><div className="mt-5 grid gap-3">{profile.bookings.length ? profile.bookings.map((booking) => <article className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-muted p-4" key={booking.id}><div><p className="font-bold">{booking.name}</p><p className="text-sm text-muted-foreground"><MapPin className="mr-1 inline h-4 w-4" />{address([booking.city, booking.region]) || "Location not set"}</p></div><div className="text-right text-sm"><p className="capitalize">{booking.status.replaceAll("_", " ")}</p>{booking.startsAt ? <p className="text-muted-foreground">{displayDate(booking.startsAt)}</p> : null}</div></article>) : <p className="text-sm text-muted-foreground">No events are recorded.</p>}</div></section> : null}
            {openSection === "emails" ? <BossProfileEmails key={profile.id} organizationId={profile.id} state={gmail} /> : null}
            {openSection === "notes" ? <section className="rounded-2xl border border-border bg-card p-5 sm:p-6"><h2 className="text-xl font-bold">Notes &amp; History</h2><div className="mt-5 grid gap-3">{recentNotes.length ? recentNotes.map((note) => <article className="rounded-xl border border-border bg-muted p-4" key={note.id}><p className="whitespace-pre-wrap text-sm">{note.body}</p><p className="mt-2 text-xs text-muted-foreground">{displayDate(note.occurredAt)}</p></article>) : <p className="text-sm text-muted-foreground">No history is recorded.</p>}</div></section> : null}

            <ConventionHistory profileId={profileId} boss />
            <section className="rounded-2xl border border-border bg-card p-5"><h2 className="text-lg font-bold">Locations / Venues ({profile.locations.length})</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{profile.locations.length ? profile.locations.map((location) => <article className="rounded-xl border border-border bg-muted p-4" key={location.id}><p className="font-bold">{location.label}</p>{location.venueName ? <p className="text-sm text-muted-foreground">{location.venueName}</p> : null}<p className="mt-2 text-sm">{address([location.address1, location.address2, location.city, location.region, location.postalCode]) || "Address not set"}</p></article>) : <p className="text-sm text-muted-foreground">No separate locations are recorded.</p>}</div></section>
          </>
        )}
      </div>
    </div>
  );
}
