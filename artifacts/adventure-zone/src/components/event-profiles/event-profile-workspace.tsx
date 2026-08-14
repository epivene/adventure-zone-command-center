"use client";

import { useState } from "react";
import { Link } from "wouter";

import { HierarchyControls } from "@/components/organizations/hierarchy-controls";
import { LocationsSection } from "@/components/organizations/locations-section";
import type { EventProfile } from "@/features/event-profiles/event-profile-repository";
import { normalizeExternalWebsite } from "@/features/organizations/website-url";

const NOTE_PAGE_SIZE = 25;

function formatDate(value: Date | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Denver" }).format(value);
}

export type EventProfileWorkspaceContext = {
  bookingId?: string;
  followUpId?: string;
  action?: "call" | "follow-up";
  mode?: "prospect";
};

function callHref(
  profile: EventProfile,
  context: EventProfileWorkspaceContext = {},
  selectedContactId: string | null = profile.selectedContactId,
  route = "/calls/new",
) {
  const query = new URLSearchParams({ organizationId: profile.id });
  if (selectedContactId) query.set("contactId", selectedContactId);
  if (context.bookingId) query.set("bookingId", context.bookingId);
  if (context.followUpId) query.set("followUpId", context.followUpId);
  if (context.action) query.set("action", context.action);
  if (context.mode) query.set("mode", context.mode);
  return `${route}?${query}`;
}

function titleCase(value: string) {
  return value.replaceAll("_", " ");
}

export function EventProfileWorkspace({
  profile,
  context = {},
  callablePhoneByContactId = {},
  assistedCallingEnabled = false,
}: {
  profile: EventProfile;
  context?: EventProfileWorkspaceContext;
  callablePhoneByContactId?: Record<string, string | null>;
  assistedCallingEnabled?: boolean;
}) {
  const [selectedContactId, setSelectedContactId] = useState(profile.selectedContactId);
  const [visibleNoteCount, setVisibleNoteCount] = useState(NOTE_PAGE_SIZE);
  const callablePhone = selectedContactId ? callablePhoneByContactId[selectedContactId] ?? null : null;
  const callingSuppressed = Boolean(selectedContactId) && !callablePhone;
  const selectedContact = profile.contacts.find(({ id }) => id === selectedContactId) ?? null;
  const selectedBooking = context.bookingId
    ? profile.bookings.find(({ id }) => id === context.bookingId) ?? null
    : null;
  const selectedFollowUp = context.followUpId
    ? profile.followUps.find(({ id }) => id === context.followUpId) ?? null
    : null;
  const placeLocation = [profile.place.address1, profile.place.city, profile.place.region, profile.place.postalCode]
    .filter(Boolean)
    .join(", ");
  const websiteHref = normalizeExternalWebsite(profile.place.website);
  const parentWebsiteHref = normalizeExternalWebsite(profile.parent?.website ?? null);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Event profile</p>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{profile.place.name}</h1>
            <p className="mt-2 text-slate-600">{placeLocation || "Location not recorded"}</p>
            {profile.place.phone ? <p className="mt-1 text-sm text-slate-600">{profile.place.phone}</p> : null}
            <div className="mt-3 grid gap-2 text-sm text-slate-600">
              <div className="flex flex-wrap items-center gap-2">
                <span>Website: {profile.place.website || "Not recorded"}</span>
                {websiteHref ? <a className="button-secondary text-center" href={websiteHref} rel="noreferrer noopener" target="_blank">Visit website</a> : null}
              </div>
              {profile.parent ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p>Part of <Link className="font-semibold hover:text-orange-700" href={`/profiles/${profile.parent.id}`}>{profile.parent.name}</Link></p>
                  <span>Parent website: {profile.parent.website || "Not recorded"}</span>
                  {parentWebsiteHref ? <a className="button-secondary text-center" href={parentWebsiteHref} rel="noreferrer noopener" target="_blank">Visit parent website</a> : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {!assistedCallingEnabled ? (
              <span className="self-center text-sm font-semibold text-slate-600">Assisted calling is not enabled.</span>
            ) : callingSuppressed ? (
              <button className="button-primary" disabled type="button">Call</button>
            ) : (
              <Link className="button-primary text-center" href={callHref(profile, context, selectedContactId)}>Call</Link>
            )}
            {assistedCallingEnabled ? <Link className="button-secondary text-center" href={callHref(profile, context, selectedContactId, "/calls/log")}>Log call</Link> : null}
            <Link className="button-secondary text-center" href="/event-profiles/new">New event</Link>
          </div>
        </div>
        {context.mode === "prospect" || context.action || selectedBooking || selectedFollowUp ? (
          <div className="mt-4 flex flex-wrap gap-2 text-sm" role="status">
            {context.mode === "prospect" ? <span className="rounded-full bg-orange-100 px-2.5 py-1 font-semibold text-orange-900">Prospect mode</span> : null}
            {context.action ? <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold capitalize text-slate-800">{context.action} action selected</span> : null}
            {selectedBooking ? <span className="rounded-full bg-indigo-100 px-2.5 py-1 font-semibold text-indigo-900">Selected booking context: {selectedBooking.name}</span> : null}
            {selectedFollowUp ? <span className="rounded-full bg-rose-100 px-2.5 py-1 font-semibold text-rose-900">Selected follow-up context: {titleCase(selectedFollowUp.kind)}</span> : null}
          </div>
        ) : null}
        {profile.place.lastResort ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-950" role="alert">
            Last Resort: {profile.place.lastResortReason || "Review this event before making commitments."}
          </p>
        ) : null}
      </header>

      <HierarchyControls
        onRefresh={() => window.location.reload()}
        profile={profile}
      />

      <LocationsSection locations={profile.locations ?? []} rollups={profile.rollups} />

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
            {profile.notes.length ? (
              <>
                <ul className="mt-4 grid gap-3">
                  {profile.notes.slice(0, visibleNoteCount).map((note) => <li className="rounded-lg border border-slate-100 p-3" key={note.id}>
                    <p className="text-sm font-semibold capitalize">{titleCase(note.kind)} · {formatDate(note.occurredAt)}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{note.body}</p>
                  </li>)}
                </ul>
                {profile.notes.length > visibleNoteCount ? (
                  <button
                    className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => setVisibleNoteCount((current) => current + NOTE_PAGE_SIZE)}
                    type="button"
                  >
                    Show older notes ({profile.notes.length - visibleNoteCount} more)
                  </button>
                ) : null}
              </>
            ) : <p className="mt-3 text-sm text-slate-600">No notes or call outcomes have been recorded.</p>}
          </section>
        </div>

        <aside className="grid gap-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="calling-queue-title">
            <h2 className="text-xl font-bold" id="calling-queue-title">Calling queue</h2>
            {selectedContact ? <div className="mt-3 grid gap-3">
              <p aria-live="polite" className="font-semibold">Current caller: {selectedContact.name}</p>
              <div className="flex flex-wrap gap-2">
                {assistedCallingEnabled && callablePhone && !callingSuppressed ? <a className="button-primary text-center" href={`tel:${callablePhone.replaceAll(/[^+\d]/g, "")}`}>Call {selectedContact.name}</a> : <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">{!assistedCallingEnabled ? "Assisted calling unavailable" : callingSuppressed ? "Calling unavailable" : "No phone recorded"}</span>}
                {profile.contacts.length > 1 ? <button className="button-secondary" onClick={() => {
                  const index = profile.contacts.findIndex(({ id }) => id === selectedContactId);
                  setSelectedContactId(profile.contacts[(index + 1) % profile.contacts.length]!.id);
                }} type="button">Next caller</button> : null}
              </div>
            </div> : <p className="mt-3 text-sm text-slate-600">No caller is available for this event.</p>}
            {profile.contacts.length > 1 ? <ul className="mt-4 grid gap-2" aria-label="Caller queue">
              {profile.contacts.map((contact) => <li key={contact.id}><button className={contact.id === selectedContactId ? "w-full rounded-lg bg-orange-100 px-3 py-2 text-left font-semibold text-orange-950" : "w-full rounded-lg bg-slate-50 px-3 py-2 text-left font-semibold text-slate-800 hover:bg-slate-100"} onClick={() => setSelectedContactId(contact.id)} type="button">{contact.name}</button></li>)}
            </ul> : null}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="event-follow-ups-title">
            <h2 className="text-xl font-bold" id="event-follow-ups-title">Follow-up</h2>
            {profile.followUps.length ? <ul className="mt-3 grid gap-3">
              {profile.followUps.map((followUp) => <li className="text-sm" key={followUp.id}>
                <p className="font-semibold capitalize">{titleCase(followUp.kind)} {followUp.id === context.followUpId ? <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-900">Selected follow-up context</span> : null}</p>
                <p className="text-slate-600">{followUp.completedAt ? `Completed ${formatDate(followUp.completedAt)}` : `Due ${formatDate(followUp.dueAt)}`}</p>
              </li>)}
            </ul> : <p className="mt-3 text-sm text-slate-600">No follow-up is scheduled.</p>}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="event-bookings-title">
            <h2 className="text-xl font-bold" id="event-bookings-title">Booking context</h2>
            {profile.bookings.length ? <ul className="mt-3 grid gap-4">
              {profile.bookings.map((booking) => <li className="grid gap-1 text-sm" key={booking.id}>
                <Link className="font-semibold hover:text-orange-700" href={`/bookings/${booking.id}`}>{booking.name}</Link>
                {booking.id === context.bookingId ? <span className="w-fit rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-900">Selected booking context</span> : null}
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
    </div>
  );
}
