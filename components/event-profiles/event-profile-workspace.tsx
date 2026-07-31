import Link from "next/link";

import type { EventProfile } from "@/features/event-profiles/event-profile-repository";

function formatDate(value: Date | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Denver" }).format(value);
}

function callHref(profile: EventProfile) {
  const query = new URLSearchParams({ organizationId: profile.id });
  if (profile.selectedContactId) query.set("contactId", profile.selectedContactId);
  return `/calls/new?${query}`;
}

function titleCase(value: string) {
  return value.replaceAll("_", " ");
}

export function EventProfileWorkspace({ profile }: { profile: EventProfile }) {
  const selectedContact = profile.contacts.find(({ id }) => id === profile.selectedContactId) ?? null;
  const placeLocation = [profile.place.address1, profile.place.city, profile.place.region, profile.place.postalCode]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Event profile</p>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{profile.place.name}</h1>
            <p className="mt-2 text-slate-600">{placeLocation || "Location not recorded"}</p>
            {profile.place.phone ? <p className="mt-1 text-sm text-slate-600">{profile.place.phone}</p> : null}
          </div>
          <Link className="button-primary text-center" href={callHref(profile)}>Record call outcome</Link>
        </div>
        {profile.place.lastResort ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-950" role="alert">
            Last Resort: {profile.place.lastResortReason || "Review this event before making commitments."}
          </p>
        ) : null}
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,1fr)]">
        <div className="grid gap-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="event-contacts-title">
            <h2 className="text-xl font-bold" id="event-contacts-title">Contacts</h2>
            {profile.contacts.length ? (
              <ul className="mt-4 divide-y divide-slate-200">
                {profile.contacts.map((contact) => (
                  <li className="grid gap-1 py-3" key={contact.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link className="font-semibold hover:text-orange-700" href={`/contacts/${contact.id}`}>{contact.name}</Link>
                      {contact.id === profile.selectedContactId ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-900">Selected for calling</span> : null}
                      {contact.isPrimary ? <span className="text-xs font-semibold text-slate-600">Primary</span> : null}
                    </div>
                    {contact.role ? <p className="text-sm text-slate-600">{contact.role}</p> : null}
                    <p className="text-sm text-slate-600">{contact.phone || "No phone"} · {contact.email || "No email"}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-slate-600">No contacts are associated with this event.</p>}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="event-notes-title">
            <h2 className="text-xl font-bold" id="event-notes-title">Notes &amp; call outcomes</h2>
            {profile.notes.length ? <ul className="mt-4 grid gap-3">
              {profile.notes.map((note) => <li className="rounded-lg border border-slate-100 p-3" key={note.id}>
                <p className="text-sm font-semibold capitalize">{titleCase(note.kind)} · {formatDate(note.occurredAt)}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{note.body}</p>
              </li>)}
            </ul> : <p className="mt-3 text-sm text-slate-600">No notes or call outcomes have been recorded.</p>}
          </section>
        </div>

        <aside className="grid gap-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="event-follow-ups-title">
            <h2 className="text-xl font-bold" id="event-follow-ups-title">Follow-up</h2>
            {profile.followUps.length ? <ul className="mt-3 grid gap-3">
              {profile.followUps.map((followUp) => <li className="text-sm" key={followUp.id}>
                <p className="font-semibold capitalize">{titleCase(followUp.kind)}</p>
                <p className="text-slate-600">{followUp.completedAt ? `Completed ${formatDate(followUp.completedAt)}` : `Due ${formatDate(followUp.dueAt)}`}</p>
              </li>)}
            </ul> : <p className="mt-3 text-sm text-slate-600">No follow-up is scheduled.</p>}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="event-bookings-title">
            <h2 className="text-xl font-bold" id="event-bookings-title">Booking context</h2>
            {profile.bookings.length ? <ul className="mt-3 grid gap-4">
              {profile.bookings.map((booking) => <li className="grid gap-1 text-sm" key={booking.id}>
                <Link className="font-semibold hover:text-orange-700" href={`/bookings/${booking.id}`}>{booking.name}</Link>
                <p className="capitalize text-slate-600">{titleCase(booking.status)} · {formatDate(booking.startsAt)}</p>
                <p className="text-slate-600">{booking.city}, {booking.region}</p>
                {booking.notes ? <p className="mt-1 whitespace-pre-wrap text-slate-700">{booking.notes}</p> : null}
              </li>)}
            </ul> : <p className="mt-3 text-sm text-slate-600">No booking is linked to this event.</p>}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="event-groups-title">
            <h2 className="text-xl font-bold" id="event-groups-title">Calling lists</h2>
            {profile.groups.length ? <ul className="mt-3 grid gap-2 text-sm">{profile.groups.map((group) => <li key={group.id}>{group.name} <span className="text-slate-600">· {group.sourceStatus}</span></li>)}</ul> : <p className="mt-3 text-sm text-slate-600">This event has no calling-list membership.</p>}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="event-sources-title">
            <h2 className="text-xl font-bold" id="event-sources-title">Source provenance</h2>
            {profile.sourceProvenance.length ? <ul className="mt-3 grid gap-2 text-sm">{profile.sourceProvenance.map((source) => <li key={`${source.entityId}:${source.sourceEntityType}:${source.actRecordId}`}><span className="font-semibold">{source.actRecordId}</span> <span className="text-slate-600">· {source.sourceEntityType}</span></li>)}</ul> : <p className="mt-3 text-sm text-slate-600">No external source record is linked.</p>}
          </section>
        </aside>
      </div>
      {selectedContact ? <p className="sr-only">Current caller: {selectedContact.name}</p> : null}
    </div>
  );
}
