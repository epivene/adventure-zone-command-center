import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ExternalLink, Mail, MapPin, Phone, UserRound } from "lucide-react";

import { createActivityAction } from "@/actions/activities";
import { apiGet } from "@/lib/auth-token";
import { ResponsiveDetailSheet } from "@/components/navigation/responsive-detail-sheet";
import { ProfileActionsMenu } from "./profile-actions-menu";
import { ProfileInlineEditor } from "./profile-inline-editor";
import { historyCategory, simplifyHistoryText } from "./history-summary";
import { formatPhoneDisplay } from "@/features/contacts/phone-display";
import { normalizeExternalWebsite } from "@/features/organizations/website-url";

export type ProfileSheetTarget = {
  profileId?: string;
  contactId?: string;
  bookingId?: string;
};

function formatDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

function formatDateTime(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ProfileDetailSheet({
  target,
  open,
  onOpenChange,
}: {
  target: ProfileSheetTarget | null;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [data, setData] = useState<any>(null);
  const [profileImageDataUrl, setProfileImageDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [recentNoteExpanded, setRecentNoteExpanded] = useState(false);
  const [noteComposerOpen, setNoteComposerOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [optimisticRecentNote, setOptimisticRecentNote] = useState<any>(null);
  const profileId = target?.profileId;

  const loadProfile = useCallback(async (reset = false) => {
    if (!open || !profileId) return;
    setLoading(true);
    setError(null);
    if (reset) {
      setEditing(false);
      setRecentNoteExpanded(false);
      setNoteComposerOpen(false);
      setNoteBody("");
      setNoteError("");
      setOptimisticRecentNote(null);
    }
    const qs = new URLSearchParams();
    if (target?.contactId) qs.set("contactId", target.contactId);
    try {
      const [next, photo] = await Promise.all([
        apiGet<any>(`/event-profiles/${profileId}${qs.toString() ? `?${qs.toString()}` : ""}`),
        apiGet<{ dataUrl: string | null }>(`/event-profiles/${profileId}/photo`).catch(() => ({ dataUrl: null })),
      ]);
      setData(next);
      setProfileImageDataUrl(photo.dataUrl ?? null);
      setOptimisticRecentNote((current: any) => {
        if (!current) return current;
        const refreshedNotes = Array.isArray(next?.notes) ? next.notes : [];
        return refreshedNotes.some((note: any) => note.id === current.id) ? null : current;
      });
    } catch (cause: any) {
      setError(cause?.message ?? "Could not load profile");
    } finally {
      setLoading(false);
    }
  }, [open, profileId, target?.contactId]);

  useEffect(() => { void loadProfile(true); }, [loadProfile]);

  async function handleInlineSaved() {
    await loadProfile(false);
    setEditing(false);
  }

  const title = useMemo(
    () => data?.place?.name ?? data?.organization?.name ?? data?.name ?? "Profile",
    [data],
  );
  if (!target || !profileId) return null;

  const place = data?.place ?? {};
  const contacts = Array.isArray(data?.contacts) ? data.contacts : [];
  const notes = Array.isArray(data?.notes) ? data.notes : [];
  const bookings = Array.isArray(data?.bookings) ? data.bookings : [];
  const followUps = Array.isArray(data?.followUps) ? data.followUps : [];
  const selectedContactId = target.contactId
    ?? data?.selectedContactId
    ?? contacts.find((contact: any) => contact.isPrimary)?.id
    ?? contacts[0]?.id
    ?? null;
  const selectedContact = contacts.find((contact: any) => contact.id === selectedContactId) ?? contacts[0] ?? null;
  const location = [place.city, place.region].filter(Boolean).join(", ");
  const fullAddress = [
    [place.address1, place.address2].filter(Boolean).join(", "),
    [place.city, place.region, place.postalCode].filter(Boolean).join(" "),
  ].filter(Boolean).join(" · ");
  const meaningfulNotes = notes.filter((note: any) => historyCategory(note) !== "system");
  const recentNote = optimisticRecentNote ?? meaningfulNotes[0] ?? null;
  const openFollowUps = [...followUps]
    .filter((item: any) => !item.completedAt)
    .sort((a: any, b: any) => new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime());
  const nextFollowUp = openFollowUps[0] ?? null;
  const followUpOverdue = Boolean(nextFollowUp && new Date(nextFollowUp.dueAt).getTime() < Date.now());
  const visiblePhone = selectedContact?.phone ?? place.phone ?? null;
  const phoneText = formatPhoneDisplay(visiblePhone);
  const callQuery = new URLSearchParams({ organizationId: profileId });
  if (selectedContactId) callQuery.set("contactId", selectedContactId);
  const callHref = visiblePhone ? `/calls/workspace?${callQuery.toString()}` : null;
  const email = selectedContact?.email ?? null;
  const websiteHref = normalizeExternalWebsite(place.website);

  function openNoteComposer() {
    setNoteComposerOpen(true);
    setNoteError("");
  }

  async function saveNote() {
    const body = noteBody.trim();
    if (!body || noteSaving) return;
    setNoteSaving(true);
    setNoteError("");
    try {
      const result = await createActivityAction({
        organizationId: profileId,
        contactId: selectedContactId ?? undefined,
        kind: "note",
        body,
        occurredAt: new Date(),
      });
      if (!result.ok) {
        setNoteError(result.error);
        return;
      }
      setOptimisticRecentNote(result.activity);
      setRecentNoteExpanded(false);
      setNoteBody("");
      setNoteComposerOpen(false);
      await loadProfile(false);
    } catch (cause) {
      setNoteError(cause instanceof Error ? cause.message : "Could not save note.");
    } finally {
      setNoteSaving(false);
    }
  }

  return (
    <ResponsiveDetailSheet
      fullPageHref={`/profiles/${profileId}${selectedContactId ? `?contactId=${encodeURIComponent(selectedContactId)}` : ""}`}
      onOpenChange={onOpenChange}
      open={open}
      title={title}
    >
      {loading && !data ? (
        <p className="text-sm text-slate-500">Loading profile…</p>
      ) : error && !data ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
      ) : data ? (
        <div className="grid gap-3 pb-2">
          {editing ? (
            <ProfileInlineEditor
              profile={data}
              contactId={selectedContactId}
              onSaved={handleInlineSaved}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              {!nextFollowUp ? (
                <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="font-bold text-emerald-900">✓ No open follow-ups</p>
                  <p className="mt-1 text-sm text-emerald-800">You’re all caught up!</p>
                </section>
              ) : followUpOverdue ? (
                <section className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <p className="font-bold text-rose-900">Follow-up overdue</p>
                  <p className="mt-1 text-sm capitalize text-rose-800">
                    {String(nextFollowUp.kind ?? "follow-up").replaceAll("_", " ")} · {formatDateTime(nextFollowUp.dueAt)}
                  </p>
                </section>
              ) : (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="font-bold text-amber-900">Follow-up needed</p>
                  <p className="mt-1 text-sm capitalize text-amber-800">
                    {String(nextFollowUp.kind ?? "follow-up").replaceAll("_", " ")} · {formatDateTime(nextFollowUp.dueAt)}
                  </p>
                </section>
              )}

              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="h-20 bg-gradient-to-r from-blue-900 via-blue-700 to-sky-400" aria-hidden="true" />
                <div className="-mt-8 flex items-start gap-3 px-4 pb-4">
                  {profileImageDataUrl ? (
                    <img
                      alt={`${title} profile`}
                      className="h-20 w-20 shrink-0 rounded-full border-4 border-white object-cover shadow-md"
                      src={profileImageDataUrl}
                    />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-white bg-blue-50 text-blue-700 shadow-md">
                      <UserRound className="h-7 w-7" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="inline-flex items-center gap-1 font-bold text-slate-950">
                          <MapPin className="h-4 w-4 shrink-0" />
                          {location || "Location not set"}
                        </p>
                        {fullAddress ? <p className="mt-1 text-sm text-slate-600">{fullAddress}</p> : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {place.placeType ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-slate-700">
                              {String(place.placeType).replaceAll("_", " ")}
                            </span>
                          ) : null}
                          {place.lastResort ? (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">Last Resort</span>
                          ) : null}
                        </div>
                      </div>
                      <button className="button-secondary shrink-0" onClick={() => setEditing(true)} type="button">Edit</button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 px-4 pb-4">
                  {callHref ? (
                    <Link
                      aria-label={phoneText ? `Open call workspace for ${phoneText}` : "Open call workspace"}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:border-orange-300 hover:text-orange-700"
                      href={callHref}
                    >
                      <Phone className="h-5 w-5" />
                    </Link>
                  ) : null}
                  {email ? (
                    <a
                      aria-label={`Email ${email}`}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:border-orange-300 hover:text-orange-700"
                      href={`mailto:${email}`}
                    >
                      <Mail className="h-5 w-5" />
                    </a>
                  ) : null}
                  {websiteHref ? (
                    <a
                      aria-label="Open website"
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:border-orange-300 hover:text-orange-700"
                      href={websiteHref}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      <ExternalLink className="h-5 w-5" />
                    </a>
                  ) : null}
                </div>

                <div className="mx-4 mb-4 grid grid-cols-2 divide-x divide-slate-200 rounded-xl bg-slate-50 py-3 text-center">
                  <p className="text-sm font-bold text-slate-900">{contacts.length} contact{contacts.length === 1 ? "" : "s"}</p>
                  <p className="text-sm font-bold text-slate-900">{bookings.length} booking{bookings.length === 1 ? "" : "s"}</p>
                </div>
              </section>

              {recentNote ? (
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bold">Recent note</h3>
                    {formatDate(recentNote.occurredAt ?? recentNote.createdAt) ? (
                      <span className="text-xs text-slate-500">{formatDate(recentNote.occurredAt ?? recentNote.createdAt)}</span>
                    ) : null}
                  </div>
                  <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 ${recentNoteExpanded ? "" : "line-clamp-4"}`}>
                    {simplifyHistoryText(recentNote.body ?? "")}
                  </p>
                  {simplifyHistoryText(recentNote.body ?? "").length > 220 ? (
                    <button
                      className="mt-2 text-sm font-semibold text-orange-700"
                      onClick={() => setRecentNoteExpanded((current) => !current)}
                      type="button"
                    >
                      {recentNoteExpanded ? "Show less" : "More"}
                    </button>
                  ) : null}
                </section>
              ) : null}

              {noteComposerOpen ? (
                <section className="grid gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3">
                  <label className="grid gap-1 text-sm font-semibold text-slate-700">
                    New note
                    <textarea
                      autoFocus
                      className="min-h-24 rounded-md border border-slate-300 bg-white px-3 py-2 font-normal"
                      value={noteBody}
                      onChange={(event) => setNoteBody(event.target.value)}
                    />
                  </label>
                  {noteError ? <p className="text-sm font-semibold text-rose-700" role="alert">{noteError}</p> : null}
                  <div className="flex gap-2">
                    <button className="button-primary" disabled={noteSaving || !noteBody.trim()} onClick={() => void saveNote()} type="button">
                      {noteSaving ? "Saving…" : "Save note"}
                    </button>
                    <button
                      className="button-secondary"
                      disabled={noteSaving}
                      onClick={() => { setNoteComposerOpen(false); setNoteBody(""); setNoteError(""); }}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </section>
              ) : null}

              <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-slate-200 bg-white/95 pt-3 backdrop-blur">
                <button className="button-primary" onClick={openNoteComposer} type="button">Add note</button>
                <ProfileActionsMenu profileId={profileId} contactId={selectedContactId} showAddNote={false} />
              </div>
            </>
          )}
        </div>
      ) : null}
    </ResponsiveDetailSheet>
  );
}
