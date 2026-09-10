import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { CalendarDays, MapPin, UserRound } from "lucide-react";
import { bossGet, bossPatch } from "@/lib/boss-auth-context";
import { OfficeProfileEditor } from "@/components/office/office-profile-editor";
import { BossProfileEmails } from "@/components/boss/boss-profile-emails";
import { ConventionHistory } from "@/components/profiles/convention-history";

type Profile = {
  id: string;
  name: string;
  description: string | null;
  profileImageDataUrl: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  website: string | null;
  contacts: Array<{
    id: string;
    name: string;
    role: string | null;
    jobTitle: string | null;
    isPrimary: boolean;
    phone: string | null;
    email: string | null;
    locationName: string | null;
  }>;
  bookings: Array<{
    id: string;
    name: string;
    city: string;
    region: string;
    startsAt: string | null;
    endsAt: string | null;
    status: string;
  }>;
  notes: Array<{ id: string; kind: string; body: string; occurredAt: string }>;
  locations: Array<{
    id: string;
    label: string;
    venueName: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    website: string | null;
    phone: string | null;
    email: string | null;
  }>;
};

function address(values: Array<string | null | undefined>) {
  return values.filter(Boolean).join(", ");
}

function date(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function BossProfilePage({ profileId }: { profileId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await bossGet<{ profile: Profile }>(`/boss/profiles/${profileId}`);
      setProfile(result.profile);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load profile.");
    }
  }, [profileId]);

  useEffect(() => { setProfile(null); setEditing(false); void load(); }, [load]);

  if (error) return <p className="rounded-xl bg-destructive/10 p-4 text-destructive" role="alert">{error}</p>;
  if (!profile) return <p className="text-sm text-muted-foreground">Loading profile…</p>;

  const profileLocation = address([profile.address1, profile.address2, profile.city, profile.region, profile.postalCode]);

  return (
    <div className="grid gap-4" data-testid="boss-profile-page">
      <ConventionHistory profileId={profileId} boss />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className="text-sm font-semibold text-primary hover:underline" href="/boss/profiles">← Profiles</Link>
        <button className="button-secondary" onClick={() => setEditing((value) => !value)} type="button">{editing ? "Close Edit" : "Edit Profile"}</button>
      </div>
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center">
          <div className="mx-auto size-24 overflow-hidden rounded-full bg-primary/10 sm:mx-0">
            {profile.profileImageDataUrl
              ? <img alt={`${profile.name} profile`} className="h-full w-full object-cover" src={profile.profileImageDataUrl} />
              : <div className="flex h-full w-full items-center justify-center text-primary"><UserRound className="h-11 w-11" /></div>}
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Event profile</p>
            <h1 className="mt-1 text-2xl font-bold">{profile.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{profileLocation || "Location not set"}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {profile.phone ? <span>{profile.phone}</span> : null}
              {profile.website ? <a className="text-primary hover:underline" href={profile.website} rel="noreferrer" target="_blank">Website</a> : null}
            </div>
          </div>
        </div>
        {profile.description ? <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">{profile.description}</p> : null}
      </section>

      {editing ? <OfficeProfileEditor profile={profile} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await load(); }} saveProfile={(id, input) => bossPatch(`/boss/profiles/${id}`, input)} /> : null}

      <BossProfileEmails key={profile.id} organizationId={profile.id} />

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-bold">Contacts ({profile.contacts.length})</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {profile.contacts.length ? profile.contacts.map((contact) => (
            <article className="rounded-lg border border-border p-3" key={contact.id}>
              <p className="font-bold"><Link className="text-primary hover:underline" href={`/boss/contacts/${contact.id}`}>{contact.name}</Link>{contact.isPrimary ? <span className="ml-2 text-xs text-primary">Primary</span> : null}</p>
              <p className="text-sm text-muted-foreground">{contact.role || contact.jobTitle || "Contact"}</p>
              {contact.phone ? <p className="mt-2 text-sm">{contact.phone}</p> : null}
              {contact.email ? <a className="text-sm text-primary hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a> : null}
              {contact.locationName ? <p className="mt-1 text-xs text-muted-foreground">{contact.locationName}</p> : null}
            </article>
          )) : <p className="text-sm text-muted-foreground">No contacts are linked.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-bold">Events ({profile.bookings.length})</h2>
        <div className="mt-3 grid gap-2">
          {profile.bookings.length ? profile.bookings.map((booking) => (
            <article className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3" key={booking.id}>
              <div><p className="font-bold">{booking.name}</p><p className="text-sm text-muted-foreground"><MapPin className="mr-1 inline h-4 w-4" />{address([booking.city, booking.region]) || "Location not set"}</p></div>
              <div className="text-right text-sm"><p className="capitalize">{booking.status.replaceAll("_", " ")}</p>{booking.startsAt ? <p className="text-muted-foreground"><CalendarDays className="mr-1 inline h-4 w-4" />{date(booking.startsAt)}</p> : null}</div>
            </article>
          )) : <p className="text-sm text-muted-foreground">No events are recorded.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-bold">Locations ({profile.locations.length})</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {profile.locations.length ? profile.locations.map((location) => (
            <article className="rounded-lg border border-border p-3" key={location.id}>
              <p className="font-bold">{location.label}</p>
              {location.venueName ? <p className="text-sm text-muted-foreground">{location.venueName}</p> : null}
              <p className="mt-2 text-sm">{address([location.address1, location.address2, location.city, location.region, location.postalCode]) || "Address not set"}</p>
              {location.phone ? <p className="text-sm">{location.phone}</p> : null}
              {location.email ? <p className="text-sm">{location.email}</p> : null}
            </article>
          )) : <p className="text-sm text-muted-foreground">No separate locations are recorded.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-bold">Notes & History ({profile.notes.length})</h2>
        <div className="mt-3 grid gap-2">
          {profile.notes.length ? profile.notes.map((note) => (
            <article className="rounded-lg border border-border p-3" key={note.id}>
              <p className="whitespace-pre-wrap text-sm">{note.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">{date(note.occurredAt)}</p>
            </article>
          )) : <p className="text-sm text-muted-foreground">No history is recorded.</p>}
        </div>
      </section>
    </div>
  );
}
