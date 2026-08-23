import { useEffect, useState } from "react";
import { Link } from "wouter";

import { ScopedNotes } from "@/components/notes/scoped-notes";
import type { ScopedNoteView } from "@/features/notes/scoped-note-types";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/auth-token";

type LocationSummary = {
  id: string;
  label: string;
  venueName: string | null;
  city: string | null;
  region: string | null;
  localStatus: string | null;
  nextFollowUp: { id: string; kind: string; dueAt: string | Date } | null;
  nextBooking: { id: string; name: string; startsAt: string | Date | null; status: string } | null;
};

type LocationDetail = LocationSummary & {
  address1: string | null;
  address2: string | null;
  postalCode: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  contacts: Array<{
    id: string;
    name: string;
    role: string | null;
    isPrimary: boolean;
    phone: string | null;
    email: string | null;
  }>;
  bookings: Array<{
    id: string;
    name: string;
    startsAt: string | Date | null;
    status: string;
    travelLeg: { id: string; name: string; color: string } | null;
  }>;
  followUps: Array<{
    id: string;
    kind: string;
    dueAt: string | Date;
    completedAt: string | Date | null;
    contactId: string | null;
    bookingId: string | null;
  }>;
  activities: Array<{
    id: string;
    kind: string;
    body: string;
    occurredAt: string | Date;
    contactId: string | null;
    bookingId: string | null;
  }>;
};

type LocationState = {
  detail: LocationDetail | null;
  notes: ScopedNoteView[];
  loading: boolean;
  error: string | null;
};

function fmt(value: string | Date | null) {
  if (!value) return "Date not set";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "America/Denver",
  }).format(new Date(value));
}

function titleCase(value: string) {
  return value.replaceAll("_", " ");
}

function address(detail: LocationDetail) {
  return [detail.address1, detail.address2, detail.city, detail.region, detail.postalCode]
    .filter(Boolean)
    .join(", ");
}

export function ProfileLocationsPanel({ profileId }: { profileId: string }) {
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [locationState, setLocationState] = useState<Record<string, LocationState>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void apiGet<{ locations: LocationSummary[] }>(`/organizations/${profileId}/locations`)
      .then((result) => {
        if (!active) return;
        setLocations(result.locations ?? []);
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Could not load Profile Locations.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [profileId]);

  async function loadLocation(locationId: string, force = false) {
    const current = locationState[locationId];
    if (!force && (current?.loading || current?.detail)) return;
    setLocationState((state) => ({
      ...state,
      [locationId]: { detail: state[locationId]?.detail ?? null, notes: state[locationId]?.notes ?? [], loading: true, error: null },
    }));
    try {
      const [detailResult, notesResult] = await Promise.all([
        apiGet<{ location: LocationDetail }>(`/organizations/${profileId}/locations/${locationId}`),
        apiGet<{ notes: ScopedNoteView[] }>(`/organizations/${profileId}/locations/${locationId}/notes`),
      ]);
      setLocationState((state) => ({
        ...state,
        [locationId]: { detail: detailResult.location, notes: notesResult.notes ?? [], loading: false, error: null },
      }));
    } catch (reason) {
      setLocationState((state) => ({
        ...state,
        [locationId]: {
          detail: state[locationId]?.detail ?? null,
          notes: state[locationId]?.notes ?? [],
          loading: false,
          error: reason instanceof Error ? reason.message : "Could not load this location.",
        },
      }));
    }
  }

  function toggle(locationId: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(locationId)) next.delete(locationId);
      else {
        next.add(locationId);
        void loadLocation(locationId);
      }
      return next;
    });
  }

  async function createNote(locationId: string, body: string) {
    const result = await apiPost<{ ok: true; note: ScopedNoteView }>(
      `/organizations/${profileId}/locations/${locationId}/notes`,
      { body },
    );
    return result.note;
  }

  async function updateNote(locationId: string, noteId: string, body: string) {
    const result = await apiPatch<{ ok: true; note: ScopedNoteView }>(
      `/organizations/${profileId}/locations/${locationId}/notes/${noteId}`,
      { body },
    );
    return result.note;
  }

  async function deleteNote(locationId: string, noteId: string) {
    await apiDelete(`/organizations/${profileId}/locations/${locationId}/notes/${noteId}`);
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-5" aria-labelledby="profile-locations-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-foreground" id="profile-locations-title">Locations</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            Each location keeps its own contacts, notes, history, bookings, and follow-ups. The main Profile still shows the overall relationship across all locations.
          </p>
        </div>
        {locations.length ? <span className="rounded-full bg-muted px-3 py-1 text-sm font-bold text-foreground">{locations.length} location{locations.length === 1 ? "" : "s"}</span> : null}
      </div>

      {loading ? <p className="mt-4 text-sm text-muted-foreground">Loading Profile Locations…</p> : null}
      {error ? <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200" role="alert">{error}</p> : null}
      {!loading && !error && !locations.length ? <p className="mt-4 text-sm text-muted-foreground">No Profile Locations have been added yet.</p> : null}

      {locations.length ? (
        <div className="mt-4 grid gap-3">
          {locations.map((location) => {
            const expanded = openIds.has(location.id);
            const state = locationState[location.id];
            const detail = state?.detail;
            return (
              <article className="overflow-hidden rounded-xl border border-border bg-background" key={location.id}>
                <button
                  className="flex w-full items-start justify-between gap-4 p-4 text-left"
                  onClick={() => toggle(location.id)}
                  type="button"
                  aria-expanded={expanded}
                >
                  <span>
                    <span className="block font-bold text-foreground">{location.label}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">{[location.city, location.region].filter(Boolean).join(", ") || "Location not set"}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {location.nextBooking ? `Next booking: ${location.nextBooking.name}` : "No upcoming booking"}
                      {location.nextFollowUp ? ` · Follow-up ${fmt(location.nextFollowUp.dueAt)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-bold text-orange-600 dark:text-orange-400">{expanded ? "Hide" : "Open"}</span>
                </button>

                {expanded ? (
                  <div className="border-t border-border p-4">
                    {state?.loading ? <p className="text-sm text-muted-foreground">Loading location details…</p> : null}
                    {state?.error ? (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                        <p>{state.error}</p>
                        <button className="mt-2 font-bold underline" onClick={() => void loadLocation(location.id, true)} type="button">Retry</button>
                      </div>
                    ) : null}
                    {detail ? (
                      <div className="grid gap-5">
                        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                          <div><p className="font-semibold text-muted-foreground">Venue / address</p><p className="mt-1 text-foreground">{detail.venueName || detail.label}<br />{address(detail) || "Not set"}</p></div>
                          <div><p className="font-semibold text-muted-foreground">Phone</p><p className="mt-1 text-foreground">{detail.phone || "Not set"}</p></div>
                          <div><p className="font-semibold text-muted-foreground">Email</p><p className="mt-1 break-all text-foreground">{detail.email || "Not set"}</p></div>
                          <div><p className="font-semibold text-muted-foreground">Local status</p><p className="mt-1 capitalize text-foreground">{detail.localStatus?.replaceAll("_", " ") || "Not set"}</p></div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                          <section className="rounded-lg border border-border bg-muted p-4">
                            <h3 className="font-bold text-foreground">Contacts</h3>
                            {detail.contacts.length ? <ul className="mt-2 grid gap-2">{detail.contacts.map((contact) => (
                              <li className="rounded-lg bg-card p-3 text-sm text-card-foreground" key={contact.id}>
                                <Link className="font-semibold text-orange-600 hover:underline dark:text-orange-400" href={`/contacts/${contact.id}`}>{contact.name}</Link>{contact.isPrimary ? <span className="ml-2 text-xs font-bold text-muted-foreground">Primary</span> : null}
                                {contact.role ? <p className="text-muted-foreground">{contact.role}</p> : null}
                                <p className="text-muted-foreground">{contact.phone || "No phone"} · {contact.email || "No email"}</p>
                              </li>
                            ))}</ul> : <p className="mt-2 text-sm text-muted-foreground">No contacts assigned to this location.</p>}
                          </section>

                          <section className="rounded-lg border border-border bg-muted p-4">
                            <h3 className="font-bold text-foreground">Bookings</h3>
                            {detail.bookings.length ? <ul className="mt-2 grid gap-2">{detail.bookings.map((booking) => (
                              <li className="rounded-lg bg-card p-3 text-sm text-card-foreground" key={booking.id}>
                                <Link className="font-semibold text-orange-600 hover:underline dark:text-orange-400" href={`/bookings/${booking.id}`}>{booking.name}</Link>
                                <p className="mt-1 text-muted-foreground">{fmt(booking.startsAt)} · <span className="capitalize">{titleCase(booking.status)}</span></p>
                              </li>
                            ))}</ul> : <p className="mt-2 text-sm text-muted-foreground">No bookings assigned to this location.</p>}
                          </section>

                          <section className="rounded-lg border border-border bg-muted p-4">
                            <h3 className="font-bold text-foreground">Follow-ups</h3>
                            {detail.followUps.length ? <ul className="mt-2 grid gap-2">{detail.followUps.map((followUp) => (
                              <li className="rounded-lg bg-card p-3 text-sm text-card-foreground" key={followUp.id}>
                                <p className="font-semibold capitalize text-foreground">{titleCase(followUp.kind)}</p>
                                <p className="text-muted-foreground">{fmt(followUp.dueAt)}{followUp.completedAt ? ` · Completed ${fmt(followUp.completedAt)}` : " · Open"}</p>
                              </li>
                            ))}</ul> : <p className="mt-2 text-sm text-muted-foreground">No follow-ups assigned to this location.</p>}
                          </section>

                          <section className="rounded-lg border border-border bg-muted p-4">
                            <h3 className="font-bold text-foreground">History</h3>
                            {detail.activities.length ? <ul className="mt-2 grid gap-2">{detail.activities.map((activity) => (
                              <li className="rounded-lg bg-card p-3 text-sm text-card-foreground" key={activity.id}>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-semibold capitalize text-foreground">{titleCase(activity.kind)}</span>
                                  <span className="text-xs text-muted-foreground">{fmt(activity.occurredAt)}</span>
                                </div>
                                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{activity.body || "No details recorded."}</p>
                              </li>
                            ))}</ul> : <p className="mt-2 text-sm text-muted-foreground">No history assigned to this location.</p>}
                          </section>
                        </div>

                        <section className="rounded-lg border border-border bg-muted p-4">
                          <ScopedNotes
                            title="Notes"
                            notes={state?.notes ?? []}
                            emptyText="No notes for this location yet."
                            onCreate={(body) => createNote(location.id, body)}
                            onUpdate={(noteId, body) => updateNote(location.id, noteId, body)}
                            onDelete={(noteId) => deleteNote(location.id, noteId)}
                          />
                        </section>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
