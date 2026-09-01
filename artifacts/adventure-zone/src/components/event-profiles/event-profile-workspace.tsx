"use client";

import { useMemo, useState } from "react";
import { Link } from "wouter";

import { ActivityTimeline } from "@/components/activities/activity-timeline";
import { FollowUpControls } from "@/components/follow-ups/follow-up-controls";
import { PossibleLocationsDrawer } from "@/components/organizations/possible-locations-drawer";
import { OrganizationMembershipDrawer } from "@/components/organizations/organization-membership-drawer";
import {
  createActivityAction,
  deleteActivityAction,
  editActivityAction,
  listActivityRevisionsAction,
  loadTimelinePageAction,
} from "@/actions/activities";
import { createFollowUpAction, deleteFollowUpAction, editFollowUpAction } from "@/actions/follow-ups";
import type { EventProfile } from "@/features/event-profiles/event-profile-repository";
import { normalizeExternalWebsite } from "@/features/organizations/website-url";
import { groupEventProfileContacts } from "@/features/event-profiles/group-event-profile-contacts";
import { ScopedNotes } from "@/components/notes/scoped-notes";
import type { ScopedNoteView } from "@/features/notes/scoped-note-types";

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
  route = "/calls/workspace",
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
  familyNotes = [],
  familyNotesError = null,
  retryFamilyNotes,
  organizationContext = { parent: null, children: [] },
  onOrganizationChanged = () => {},
}: {
  profile: EventProfile;
  context?: EventProfileWorkspaceContext;
  callablePhoneByContactId?: Record<string, string | null>;
  assistedCallingEnabled?: boolean;
  familyNotes?: ScopedNoteView[];
  familyNotesError?: string | null;
  retryFamilyNotes?: () => void;
  organizationContext?: { parent: { id: string; name: string; city: string | null; region: string | null } | null; children: { id: string; name: string; city: string | null; region: string | null }[] };
  onOrganizationChanged?: () => void;
}) {
  const [selectedContactId, setSelectedContactId] = useState(profile.selectedContactId);
  const [showLocations, setShowLocations] = useState<Record<string, boolean>>({});
  const [followUpItems, setFollowUpItems] = useState(profile.followUps);
  const [newFollowUpKind, setNewFollowUpKind] = useState("email");
  const [newFollowUpDueAt, setNewFollowUpDueAt] = useState("");
  const [newFollowUpSaving, setNewFollowUpSaving] = useState(false);
  const [newFollowUpError, setNewFollowUpError] = useState("");
  const [membershipDrawer, setMembershipDrawer] = useState<"add-child" | "choose-parent" | null>(null);
  const groupedContacts = useMemo(() => groupEventProfileContacts(profile.contacts), [profile.contacts]);
  const selectedContact = groupedContacts.find(({ id }) => id === selectedContactId) ?? groupedContacts[0] ?? null;
  const callablePhone = selectedContact
    ? selectedContact.contactIds.map((id) => callablePhoneByContactId[id]).find((phone): phone is string => Boolean(phone)) ?? null
    : null;
  const callingSuppressed = Boolean(selectedContact) && !callablePhone;
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
  const organizationLike = organizationContext.children.length > 0 || ["company", "association", "city_government", "tribe", "school"].includes(profile.place.placeType);

  const newFollowUpDueAtValid = /^\\d{4}-\\d{2}-\\d{2}$/.test(newFollowUpDueAt) && !Number.isNaN(new Date(`${newFollowUpDueAt}T12:00:00`).getTime());

  async function saveNewFollowUp() {
    if (!newFollowUpDueAtValid || newFollowUpSaving) return;
    setNewFollowUpSaving(true);
    setNewFollowUpError("");
    const dueAt = new Date(`${newFollowUpDueAt}T12:00:00`);
    const result = await createFollowUpAction({
      organizationId: profile.id,
      contactId: selectedContact?.contactIds[0] ?? null,
      bookingId: selectedBooking?.id ?? null,
      kind: newFollowUpKind,
      dueAt,
    });
    if (result.ok) {
      setFollowUpItems((items) => [...items, result.followUp]);
      setNewFollowUpDueAt("");
    } else {
      setNewFollowUpError(result.error);
    }
    setNewFollowUpSaving(false);
  }

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
            <Link className="button-secondary text-center" href={`/event-profiles/${profile.id}/edit`}>Edit profile</Link>
            <Link className="button-secondary text-center" href="/event-profiles/new">Add Event / Lead</Link>
          </div>
        </div>
        {context.mode === "prospect" || context.action || selectedBooking || selectedFollowUp ? (
          <div className="mt-4 flex flex-wrap gap-2 text-sm" role="status">
            {context.mode === "prospect" ? <span className="rounded-full bg-orange-100 px-2.5 py-1 font-semibold text-orange-900">Prospect mode</span> : null}
            {context.action ? <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold capitalize text-slate-800">{context.action} action selected</span> : null}
            {selectedBooking ? <span className="rounded-full bg-indigo-100 px-2.5 py-1 font-semibold text-indigo-900">Selected booking context: {selectedBooking.name}</span> : null}
            {selectedFollowUp ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-900">Selected follow-up context: {titleCase(selectedFollowUp.kind)}</span> : null}
          </div>
        ) : null}
        {profile.familyContext ? (
          <p className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-950">
            {profile.familyContext.kind === "event_family" ? "Part of" : "Location of"}{" "}
            <Link className="underline" href={profile.familyContext.kind === "event_family" ? `/event-families/${profile.familyContext.id}` : `/profiles/${profile.familyContext.id}`}>{profile.familyContext.name}</Link>
          </p>
        ) : null}
        <div className="mt-4 grid gap-3">
          {organizationContext.parent ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm">
              <p className="font-semibold text-sky-950">Part of <Link className="underline" href={`/profiles/${organizationContext.parent.id}`}>{organizationContext.parent.name}</Link></p>
              <button className="button-secondary" onClick={() => setMembershipDrawer("choose-parent")} type="button">Change organization…</button>
            </div>
          ) : !organizationLike ? (
            <button className="button-secondary justify-self-start" onClick={() => setMembershipDrawer("choose-parent")} type="button">Add to organization…</button>
          ) : null}

          {organizationLike ? (
            <section className="rounded-lg border border-slate-200 bg-slate-50 p-4" aria-labelledby="locations-events-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold" id="locations-events-title">Locations &amp; Events</h2>
                <button className="button-secondary" onClick={() => setMembershipDrawer("add-child")} type="button">+ Add location/event</button>
              </div>
              {organizationContext.children.length ? (
                <ul className="mt-3 grid gap-2">
                  {organizationContext.children.map((child) => (
                    <li key={child.id}>
                      <Link className="block rounded-lg bg-white px-3 py-2 font-semibold hover:text-orange-700" href={`/profiles/${child.id}`}>
                        {child.name}{child.city || child.region ? ` — ${[child.city, child.region].filter(Boolean).join(", ")}` : ""}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-slate-600">No locations or events have been added yet.</p>}
            </section>
          ) : null}
        </div>
        {membershipDrawer ? (
          <OrganizationMembershipDrawer
            mode={membershipDrawer}
            profileId={profile.id}
            parentOrganization={membershipDrawer === "add-child" ? { id: profile.id, name: profile.place.name } : null}
            currentParent={organizationContext.parent ? { id: organizationContext.parent.id, name: organizationContext.parent.name } : null}
            open
            onClose={() => setMembershipDrawer(null)}
            onChanged={onOrganizationChanged}
          />
        ) : null}
        {profile.place.lastResort ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-950" role="alert">
            Last Resort: {profile.place.lastResortReason || "Review this event before making commitments."}
          </p>
        ) : null}
      </header>

      <PossibleLocationsDrawer orgId={profile.id} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,1fr)]">
        <div className="grid gap-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="event-contacts-title">
            <h2 className="text-xl font-bold" id="event-contacts-title">Contacts</h2>
            {groupedContacts.length ? (
              <ul className="mt-4 divide-y divide-slate-200">
                {groupedContacts.map((contact) => (
                  <li className="grid gap-1 py-3" key={contact.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link className="font-semibold hover:text-orange-700" href={`/contacts/${contact.id}`}>{contact.name}</Link>
                      <span className="flex flex-wrap items-center gap-2">
                        {contact.id === profile.selectedContactId ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-900">Selected for calling</span> : null}
                        <Link className="text-xs font-semibold text-orange-700 hover:text-orange-900" href={`/contacts/${contact.id}/edit`}>Edit contact</Link>
                      </span>
                      {contact.isPrimary ? <span className="text-xs font-semibold text-slate-600">Primary</span> : null}
                    </div>
                    {contact.role ? <p className="text-sm text-slate-600">{contact.role}</p> : null}
                    <p className="text-sm text-slate-600">{contact.phone || "No phone"} · {contact.email || "No email"}</p>
                    {contact.locations.length ? <div className="text-sm text-slate-600">
                      <button className="font-semibold text-orange-700 hover:text-orange-900" onClick={() => setShowLocations((current) => ({ ...current, [contact.id]: !current[contact.id] }))} type="button">
                        Locations: {contact.locations.length}
                      </button>
                      {showLocations[contact.id] ? <ul className="mt-1 ml-4 list-disc text-slate-600">{contact.locations.map((location) => <li key={location}>{location}</li>)}</ul> : null}
                    </div> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-slate-600">No contacts are associated with this event.</p>}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="event-notes-title">
            <h2 className="text-xl font-bold" id="event-notes-title">Notes &amp; call outcomes</h2>
            <div className="mt-4">
              <ActivityTimeline
                noteComposer
                activities={profile.notes.map((note) => ({
                  id: note.id,
                  organizationId: profile.id,
                  contactId: note.contactId,
                  bookingId: note.bookingId,
                  kind: note.kind as any,
                  body: note.body,
                  occurredAt: note.occurredAt instanceof Date ? note.occurredAt : new Date(note.occurredAt),
                  createdAt: note.createdAt instanceof Date ? note.createdAt : new Date(note.createdAt),
                  updatedAt: note.updatedAt instanceof Date ? note.updatedAt : new Date(note.updatedAt),
                  revisionCount: 0,
                  callOutcome: null,
                  hasLinkedCallSession: false,
                  importedFromAct: Boolean(note.importedFromAct),
                  actSourceType:
                    note.actSourceType === "note" ||
                    note.actSourceType === "history" ||
                    note.actSourceType === "activity"
                      ? note.actSourceType
                      : null,
                }))}
                parent={{ organizationId: profile.id }}
                createActivity={createActivityAction}
                editActivity={editActivityAction}
                deleteActivity={deleteActivityAction}
                loadRevisions={listActivityRevisionsAction}
                loadPage={(page) => loadTimelinePageAction({ organizationId: profile.id }, page)}
              />
            </div>
          </section>
          {profile.familyContext?.kind === "event_family" ? (
            <section className="rounded-xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
              {familyNotesError ? (
                <div className="grid gap-2">
                  <h2 className="text-xl font-bold">Family notes — {profile.familyContext.name}</h2>
                  <p className="text-sm text-rose-700" role="alert">{familyNotesError}</p>
                  {retryFamilyNotes ? <button className="button-secondary w-fit" type="button" onClick={retryFamilyNotes}>Retry family notes</button> : null}
                  <Link className="text-sm font-semibold text-orange-800 hover:underline" href={`/event-families/${profile.familyContext.id}`}>Open event family</Link>
                </div>
              ) : (
                <ScopedNotes title={`Family notes — ${profile.familyContext.name}`} notes={familyNotes} readOnly footer={<Link className="font-semibold text-orange-800 hover:underline" href={`/event-families/${profile.familyContext.id}`}>Open event family</Link>} />
              )}
            </section>
          ) : null}
        </div>

        <aside className="grid gap-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="calling-queue-title">
            <h2 className="text-xl font-bold" id="calling-queue-title">Calling queue</h2>
            {selectedContact ? <div className="mt-3 grid gap-3">
              <p aria-live="polite" className="font-semibold">Current caller: {selectedContact.name}</p>
              <div className="flex flex-wrap gap-2">
                {assistedCallingEnabled && callablePhone && !callingSuppressed ? <a className="button-primary text-center" href={`tel:${callablePhone.replaceAll(/[^+\d]/g, "")}`}>Call {selectedContact.name}</a> : <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">{!assistedCallingEnabled ? "Assisted calling unavailable" : callingSuppressed ? "Calling unavailable" : "No phone recorded"}</span>}
                {groupedContacts.length > 1 ? <button className="button-secondary" onClick={() => {
                  const index = groupedContacts.findIndex(({ id }) => id === selectedContactId);
                  setSelectedContactId(groupedContacts[(index + 1) % groupedContacts.length]!.id);
                }} type="button">Next caller</button> : null}
              </div>
            </div> : <p className="mt-3 text-sm text-slate-600">No caller is available for this event.</p>}
            {groupedContacts.length > 1 ? <ul className="mt-4 grid gap-2" aria-label="Caller queue">
              {groupedContacts.map((contact) => <li key={contact.id}><button className={contact.id === selectedContactId ? "w-full rounded-lg bg-orange-100 px-3 py-2 text-left font-semibold text-orange-950" : "w-full rounded-lg bg-slate-50 px-3 py-2 text-left font-semibold text-slate-800 hover:bg-slate-100"} onClick={() => setSelectedContactId(contact.id)} type="button">{contact.name}{contact.locations.length > 1 ? <span className="ml-2 text-xs font-normal text-slate-600">({contact.locations.length} locations)</span> : null}</button></li>)}
            </ul> : null}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="event-follow-ups-title">
            <h2 className="text-xl font-bold" id="event-follow-ups-title">Follow-up</h2>
            {context.action === "follow-up" ? (
              <div className="mt-3 grid gap-3 rounded-lg border border-orange-200 bg-orange-50 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm font-semibold text-slate-800">
                    Follow-up type
                    <select aria-label="Follow-up type" value={newFollowUpKind} onChange={(event) => setNewFollowUpKind(event.target.value)}>
                      <option value="email">Email</option>
                      <option value="call">Call</option>
                      <option value="application">Application check</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-slate-800">
                    Due date
                    <input aria-label="Due date" inputMode="numeric" maxLength={10} placeholder="YYYY-MM-DD" type="text" value={newFollowUpDueAt} onChange={(event) => setNewFollowUpDueAt(event.target.value)} />
                  </label>
                </div>
                {newFollowUpError ? <p className="text-sm font-semibold text-red-700" role="alert">{newFollowUpError}</p> : null}
                <button className="button-primary justify-self-start" disabled={!newFollowUpDueAtValid || newFollowUpSaving} onClick={() => void saveNewFollowUp()} type="button">
                  {newFollowUpSaving ? "Saving…" : "Save follow-up"}
                </button>
              </div>
            ) : null}
            {followUpItems.length ? <ul className="mt-3 grid gap-3">
              {followUpItems.map((followUp) => <li className="rounded-lg border border-slate-100 p-3 text-sm" key={followUp.id}>
                <p className="font-semibold capitalize">{titleCase(followUp.kind)} {followUp.id === context.followUpId ? <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-900">Selected follow-up context</span> : null}</p>
                <p className="text-slate-600">{followUp.completedAt ? `Completed ${formatDate(followUp.completedAt)}` : `Due ${formatDate(followUp.dueAt)}`}</p>
                <FollowUpControls
                  followUp={followUp}
                  onEdit={async (id, input) => {
                    const result = await editFollowUpAction({ followUpId: id, kind: input.kind, dueAt: new Date(input.dueAt), completed: false, outcome: null });
                    if (result.ok) {
                      setFollowUpItems((items) =>
                        items.map((f) =>
                          f.id === id
                            ? { ...f, kind: result.followUp.kind, dueAt: result.followUp.dueAt }
                            : f,
                        ),
                      );
                    }
                    return result;
                  }}
                  onDelete={async (id) => {
                    const result = await deleteFollowUpAction(id);
                    if (result.ok) setFollowUpItems((items) => items.filter((f) => f.id !== id));
                    return result;
                  }}
                />
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

        </aside>
      </div>
    </div>
  );
}
