import { useMemo, useState } from "react";
import { Link } from "wouter";

import { ActivityTimeline } from "@/components/activities/activity-timeline";
import { ProfileActionsMenu } from "@/components/profiles/profile-actions-menu";
import {
  createActivityAction,
  deleteActivityAction,
  editActivityAction,
  listActivityRevisionsAction,
  loadTimelinePageAction,
} from "@/actions/activities";
import type { EventProfile } from "@/features/event-profiles/event-profile-repository";
import { normalizeExternalWebsite } from "@/features/organizations/website-url";

type Tab = "overview" | "notes" | "events";

function formatDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Denver" }).format(date);
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Denver" }).format(date);
}

export function SimpleFullProfile({ profile }: { profile: EventProfile }) {
  const [tab, setTab] = useState<Tab>("overview");
  const primaryContact = profile.contacts.find((contact) => contact.isPrimary) ?? profile.contacts[0] ?? null;
  const websiteHref = normalizeExternalWebsite(profile.place.website);
  const location = [profile.place.city, profile.place.region].filter(Boolean).join(", ");

  const nextFollowUp = useMemo(() => [...profile.followUps]
    .filter((item) => !item.completedAt && item.dueAt)
    .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime())[0] ?? null, [profile.followUps]);

  const nextEvent = useMemo(() => [...profile.bookings]
    .filter((item) => item.startsAt && new Date(item.startsAt).getTime() >= Date.now())
    .sort((left, right) => new Date(left.startsAt!).getTime() - new Date(right.startsAt!).getTime())[0] ?? null, [profile.bookings]);

  const recentNote = profile.notes[0] ?? null;

  return (
    <div className="grid gap-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{profile.place.name}</h1>
            {location ? <p className="mt-1 text-sm font-medium text-slate-600">{location}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {profile.place.placeType ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{profile.place.placeType.replaceAll("_", " ")}</span> : null}
              {profile.place.lastResort ? <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">Last Resort</span> : null}
              {profile.familyContext ? <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800">{profile.familyContext.kind === "event_family" ? "Family" : "Organization"}: {profile.familyContext.name}</span> : null}
            </div>
          </div>
          <ProfileActionsMenu profileId={profile.id} contactId={primaryContact?.id ?? null} />
        </div>

        {primaryContact ? (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="font-semibold text-slate-900">{primaryContact.name}{primaryContact.role ? <span className="font-normal text-slate-500"> · {primaryContact.role}</span> : null}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {primaryContact.phone ? <a className="font-medium text-orange-700" href={`tel:${primaryContact.phone}`}>{primaryContact.phone}</a> : null}
              {primaryContact.email ? <a className="font-medium text-orange-700" href={`mailto:${primaryContact.email}`}>{primaryContact.email}</a> : null}
            </div>
          </div>
        ) : profile.place.phone ? <a className="mt-3 block text-sm font-medium text-orange-700" href={`tel:${profile.place.phone}`}>{profile.place.phone}</a> : null}
      </section>

      <div role="tablist" aria-label="Full profile sections" className="grid grid-cols-3 rounded-xl bg-slate-100 p-1">
        {(["overview", "notes", "events"] as Tab[]).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`rounded-lg px-3 py-2 text-sm font-semibold capitalize ${tab === value ? "bg-white text-orange-700 shadow-sm" : "text-slate-600"}`}>{value}</button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-bold">What matters next</h2>
            <div className="mt-3 grid gap-3">
              {nextFollowUp ? <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Next follow-up</p><p className="mt-1 font-semibold capitalize">{nextFollowUp.kind.replaceAll("_", " ")} · {formatDateTime(nextFollowUp.dueAt)}</p></div> : <p className="text-sm text-slate-600">No open follow-up.</p>}
              {nextEvent ? <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Next event</p><p className="mt-1 font-semibold">{nextEvent.name}</p><p className="text-sm text-slate-600">{formatDateTime(nextEvent.startsAt)}</p></div> : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-bold">Profile details</h2>
            <div className="mt-3 grid gap-2 text-sm text-slate-700">
              {profile.place.address1 ? <p>{[profile.place.address1, profile.place.address2, profile.place.city, profile.place.region, profile.place.postalCode].filter(Boolean).join(", ")}</p> : null}
              {websiteHref ? <a className="font-medium text-orange-700" href={websiteHref} rel="noreferrer noopener" target="_blank">Visit website</a> : null}
              <p>{profile.contacts.length} contact{profile.contacts.length === 1 ? "" : "s"} · {profile.bookings.length} event{profile.bookings.length === 1 ? "" : "s"}</p>
            </div>
          </section>

          {recentNote ? <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:col-span-2"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Recent note</p><p className="mt-2 line-clamp-5 whitespace-pre-wrap text-sm text-slate-700">{recentNote.body}</p></section> : null}

          {profile.contacts.length > 1 ? (
            <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:col-span-2">
              <summary className="cursor-pointer font-semibold">All contacts ({profile.contacts.length})</summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {profile.contacts.map((contact) => <Link key={contact.id} href={`/contacts/${contact.id}`} className="rounded-lg border border-slate-200 p-3 hover:border-orange-300"><p className="font-semibold">{contact.name}</p><p className="mt-1 text-sm text-slate-600">{contact.role || "Contact"}</p></Link>)}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      {tab === "notes" ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div><h2 className="text-lg font-bold">Notes & communication</h2><p className="mt-1 text-sm text-slate-600">Add notes and keep useful call context in one place.</p></div>
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
                actSourceType: note.actSourceType === "note" || note.actSourceType === "history" || note.actSourceType === "activity" ? note.actSourceType : null,
              }))}
              parent={{ organizationId: profile.id }}
              createActivity={createActivityAction}
              editActivity={editActivityAction}
              deleteActivity={deleteActivityAction}
              loadRevisions={listActivityRevisionsAction}
              loadPage={(page) => loadTimelinePageAction({ organizationId: profile.id }, page)}
            />
          </div>
          {profile.followUps.length ? <details className="mt-4 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Follow-ups ({profile.followUps.length})</summary><ul className="mt-2 grid gap-2">{profile.followUps.map((item) => <li className="rounded-lg bg-slate-50 p-3 text-sm" key={item.id}><span className="font-semibold capitalize">{item.kind.replaceAll("_", " ")}</span><span className="ml-2 text-slate-600">{formatDate(item.dueAt)}</span></li>)}</ul></details> : null}
        </section>
      ) : null}

      {tab === "events" ? (
        <section className="grid gap-2">
          {profile.bookings.length ? profile.bookings.map((booking) => (
            <Link key={booking.id} href={`/bookings/${booking.id}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange-300">
              <div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-slate-950">{booking.name}</h2><p className="mt-1 text-sm text-slate-600">{[booking.city, booking.region].filter(Boolean).join(", ")}</p></div><span className="text-sm font-semibold capitalize text-slate-500">{booking.status.replaceAll("_", " ")}</span></div>
              <p className="mt-2 text-sm text-slate-600">{formatDate(booking.startsAt) ?? "Date not set"}</p>
            </Link>
          )) : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">No events yet.</div>}
        </section>
      ) : null}
    </div>
  );
}
