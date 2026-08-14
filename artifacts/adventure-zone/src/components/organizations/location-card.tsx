/**
 * Collapsible card for a single organization_locations record.
 * Compact summary when collapsed; fetches full detail when expanded.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";

import { apiDelete, apiFetch, apiGet } from "@/lib/auth-token";
import { normalizeExternalWebsite } from "@/features/organizations/website-url";
import type { LocationFormInitial } from "./location-form";

// ─── Types (matching api-server OrgLocationSummary / OrgLocationDetail) ───────

export type LocationTravelLeg = { id: string; name: string; color: string };

export type LocationSummary = {
  id: string;
  label: string;
  venueName: string | null;
  city: string | null;
  region: string | null;
  localStatus: string | null;
  nextFollowUp: { id: string; kind: string; dueAt: string } | null;
  nextBooking: { id: string; name: string; startsAt: string | null; status: string } | null;
  travelLeg: LocationTravelLeg | null;
};

type LocationContact = {
  id: string;
  name: string;
  role: string | null;
  isPrimary: boolean;
  phone: string | null;
  email: string | null;
};

type LocationBooking = {
  id: string;
  name: string;
  startsAt: string | null;
  status: string;
  travelLeg: LocationTravelLeg | null;
};

type LocationFollowUp = {
  id: string;
  kind: string;
  dueAt: string;
  completedAt: string | null;
  contactId: string | null;
  bookingId: string | null;
};

type LocationActivity = {
  id: string;
  kind: string;
  body: string;
  occurredAt: string;
  contactId: string | null;
  bookingId: string | null;
};

type LocationDetail = LocationSummary & {
  address1: string | null;
  address2: string | null;
  postalCode: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  /** Null when no coordinates have been recorded. */
  coordinate: { lat: number; lng: number } | null;
  contacts: LocationContact[];
  bookings: LocationBooking[];
  followUps: LocationFollowUp[];
  activities: LocationActivity[];
  activitiesNextPage: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "America/Denver",
  }).format(new Date(value));
}

function titleCase(value: string) {
  return value.replaceAll("_", " ");
}

function summaryLabel(loc: LocationSummary): string {
  if (loc.label) return loc.label;
  return [loc.city, loc.region].filter(Boolean).join(", ") || "Unnamed location";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-slate-700">
      {titleCase(status)}
    </span>
  );
}

function TravelLegChip({ leg }: { leg: LocationTravelLeg }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
      style={{ backgroundColor: leg.color || "#64748b" }}
    >
      {leg.name}
    </span>
  );
}

function WebsiteLink({ website }: { website: string | null }) {
  const href = normalizeExternalWebsite(website);
  if (!href && !website) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
      <span className="break-all">{website}</span>
      {href ? (
        <a
          className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          href={href}
          rel="noreferrer noopener"
          target="_blank"
        >
          Visit ↗
        </a>
      ) : null}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LocationCard({
  orgId,
  location,
  onEdit,
  onRemoved,
  detailVersion = 0,
}: {
  orgId: string;
  location: LocationSummary;
  onEdit: (initial: LocationFormInitial) => void;
  onRemoved: (id: string) => void;
  /** Increment this to invalidate the cached detail and force a re-fetch on next expand. */
  detailVersion?: number;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<LocationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Cursor-based activity pagination
  const [activities, setActivities] = useState<LocationActivity[]>([]);
  const [actCursor, setActCursor] = useState<string | null>(null);
  const [actLoadingMore, setActLoadingMore] = useState(false);

  // When detailVersion bumps (parent signals a successful edit), clear the
  // cached detail so the next expand re-fetches fresh data from the server.
  const [prevDetailVersion, setPrevDetailVersion] = useState(detailVersion);
  useEffect(() => {
    if (detailVersion !== prevDetailVersion) {
      setPrevDetailVersion(detailVersion);
      setDetail(null);
      setActivities([]);
      setActCursor(null);
    }
  }, [detailVersion, prevDetailVersion]);

  async function handleToggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (detail) return; // already loaded
    setDetailLoading(true);
    setDetailError(null);
    try {
      const data = await apiGet<{ location: LocationDetail }>(
        `/organizations/${orgId}/locations/${location.id}`,
      );
      setDetail(data.location);
      setActivities(data.location.activities);
      setActCursor(data.location.activitiesNextPage);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to load location detail.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadMoreActivities() {
    if (!actCursor || actLoadingMore) return;
    setActLoadingMore(true);
    try {
      const res = await apiFetch(
        `/organizations/${orgId}/locations/${location.id}/activities?cursor=${encodeURIComponent(actCursor)}`,
      );
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json() as { activities: LocationActivity[]; activitiesNextPage: string | null };
      setActivities((prev) => [...prev, ...data.activities]);
      setActCursor(data.activitiesNextPage);
    } catch (err) {
      // Non-fatal — user can retry
      console.error("Failed to load more activities", err);
    } finally {
      setActLoadingMore(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiDelete(`/organizations/${orgId}/locations/${location.id}`);
      onRemoved(location.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete location.");
      setDeleting(false);
    }
  }

  function openEdit() {
    // Prefer loaded detail (has all fields); fall back to summary for basic fields.
    const d = detail;
    onEdit({
      id: location.id,
      label: location.label ?? "",
      venueName: d?.venueName ?? "",
      address1: d?.address1 ?? "",
      address2: d?.address2 ?? "",
      city: location.city ?? "",
      region: location.region ?? "",
      postalCode: d?.postalCode ?? "",
      // Show the stored website value (which may already be normalized by the server).
      website: d?.website ?? "",
      phone: d?.phone ?? "",
      email: d?.email ?? "",
      localStatus: location.localStatus ?? "",
      // Carry coordinate as decimal strings; empty string if not set.
      lat: d?.coordinate?.lat != null ? String(d.coordinate.lat) : "",
      lng: d?.coordinate?.lng != null ? String(d.coordinate.lng) : "",
    });
  }

  const displayLabel = summaryLabel(location);

  return (
    <li className="rounded-lg border border-slate-200 bg-white">
      {/* ── Compact summary row ─────────────────────────────────────────── */}
      <button
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
      >
        <span className="mt-0.5 select-none text-slate-400">{open ? "▾" : "▸"}</span>
        <div className="min-w-0 flex-1 grid gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{displayLabel}</span>
            {location.localStatus ? <StatusBadge status={location.localStatus} /> : null}
            {location.travelLeg ? <TravelLegChip leg={location.travelLeg} /> : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-slate-500">
            {location.city || location.region ? (
              <span>{[location.city, location.region].filter(Boolean).join(", ")}</span>
            ) : null}
            {location.nextFollowUp ? (
              <span>Follow-up due {fmtDate(location.nextFollowUp.dueAt)}</span>
            ) : null}
            {location.nextBooking ? (
              <span>
                Next booking: {location.nextBooking.name} ·{" "}
                {fmtDate(location.nextBooking.startsAt)}
              </span>
            ) : null}
          </div>
        </div>
      </button>

      {/* ── Expanded detail ──────────────────────────────────────────────── */}
      {open && (
        <div className="border-t border-slate-100 px-4 py-4">
          {detailLoading && (
            <p className="text-sm text-slate-500">Loading…</p>
          )}
          {detailError && (
            <p className="text-sm text-rose-700">{detailError}</p>
          )}

          {detail && (
            <div className="grid gap-5">
              {/* Address / contact info */}
              <div className="grid gap-2 text-sm text-slate-700">
                {(detail.address1 || detail.address2 || detail.city) && (
                  <p>
                    {[
                      detail.address1,
                      detail.address2,
                      [detail.city, detail.region, detail.postalCode]
                        .filter(Boolean)
                        .join(", "),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {detail.website ? <WebsiteLink website={detail.website} /> : null}
                {detail.phone ? (
                  <p>
                    <span className="font-semibold">Phone:</span>{" "}
                    <a className="hover:text-orange-700" href={`tel:${detail.phone}`}>
                      {detail.phone}
                    </a>
                  </p>
                ) : null}
                {detail.email ? (
                  <p>
                    <span className="font-semibold">Email:</span>{" "}
                    <a className="hover:text-orange-700" href={`mailto:${detail.email}`}>
                      {detail.email}
                    </a>
                  </p>
                ) : null}
                {detail.coordinate ? (
                  <p>
                    <span className="font-semibold">Coordinates:</span>{" "}
                    <a
                      className="hover:text-orange-700"
                      href={`https://maps.google.com/?q=${detail.coordinate.lat},${detail.coordinate.lng}`}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      {detail.coordinate.lat}, {detail.coordinate.lng} ↗
                    </a>
                  </p>
                ) : null}
              </div>

              {/* Contacts */}
              {detail.contacts.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-slate-700">Contacts</h4>
                  <ul className="mt-2 divide-y divide-slate-100">
                    {detail.contacts.map((c) => (
                      <li className="grid gap-0.5 py-2 text-sm" key={c.id}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            className="font-semibold hover:text-orange-700"
                            href={`/contacts/${c.id}`}
                          >
                            {c.name}
                          </Link>
                          {c.isPrimary && (
                            <span className="text-xs font-semibold text-slate-500">Primary</span>
                          )}
                        </div>
                        {c.role && <p className="text-slate-500">{c.role}</p>}
                        <p className="text-slate-500">
                          {c.phone || "No phone"} · {c.email || "No email"}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Bookings */}
              {detail.bookings.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-slate-700">Bookings</h4>
                  <ul className="mt-2 divide-y divide-slate-100">
                    {detail.bookings.map((b) => (
                      <li className="grid gap-0.5 py-2 text-sm" key={b.id}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            className="font-semibold hover:text-orange-700"
                            href={`/bookings/${b.id}`}
                          >
                            {b.name}
                          </Link>
                          {b.travelLeg && <TravelLegChip leg={b.travelLeg} />}
                        </div>
                        <p className="capitalize text-slate-500">
                          {titleCase(b.status)} · {fmtDate(b.startsAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Follow-ups */}
              {detail.followUps.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-slate-700">Follow-ups</h4>
                  <ul className="mt-2 divide-y divide-slate-100">
                    {detail.followUps.map((f) => (
                      <li className="py-2 text-sm" key={f.id}>
                        <p className="font-semibold capitalize">{titleCase(f.kind)}</p>
                        <p className="text-slate-500">
                          {f.completedAt
                            ? `Completed ${fmtDate(f.completedAt)}`
                            : `Due ${fmtDate(f.dueAt)}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Activity history */}
              {activities.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-slate-700">Activity history</h4>
                  <ul className="mt-2 grid gap-2">
                    {activities.map((a) => (
                      <li
                        className="rounded-lg border border-slate-100 p-3 text-sm"
                        key={a.id}
                      >
                        <p className="font-semibold capitalize text-slate-700">
                          {titleCase(a.kind)} · {fmtDate(a.occurredAt)}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-slate-600">{a.body}</p>
                      </li>
                    ))}
                  </ul>
                  {actCursor && (
                    <button
                      className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      disabled={actLoadingMore}
                      type="button"
                      onClick={loadMoreActivities}
                    >
                      {actLoadingMore ? "Loading…" : "Show more activity"}
                    </button>
                  )}
                </div>
              )}

              {/* Edit / Remove */}
              <div className="flex flex-wrap items-start gap-3 border-t border-slate-100 pt-4">
                <button
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  type="button"
                  onClick={openEdit}
                >
                  Edit
                </button>

                {!confirmDelete ? (
                  <button
                    className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                    type="button"
                    onClick={() => { setConfirmDelete(true); setDeleteError(null); }}
                  >
                    Remove
                  </button>
                ) : (
                  <div className="grid gap-2">
                    {deleteError ? (
                      <p className="max-w-sm rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        {deleteError}
                      </p>
                    ) : (
                      <p className="text-sm font-semibold text-rose-800">
                        Remove this location permanently?
                      </p>
                    )}
                    {!deleteError && (
                      <div className="flex gap-2">
                        <button
                          className="rounded-md border border-rose-300 bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                          disabled={deleting}
                          type="button"
                          onClick={handleDelete}
                        >
                          {deleting ? "Removing…" : "Yes, remove"}
                        </button>
                        <button
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                          type="button"
                          onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {deleteError && (
                      <button
                        className="w-fit rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        type="button"
                        onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
                      >
                        OK
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
