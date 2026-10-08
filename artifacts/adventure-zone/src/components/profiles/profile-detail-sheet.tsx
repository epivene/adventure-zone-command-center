import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Building2, ExternalLink, Mail, MapPin, Phone } from "lucide-react";

import { createActivityAction } from "@/actions/activities";
import { apiGet } from "@/lib/auth-token";
import { ResponsiveDetailSheet } from "@/components/navigation/responsive-detail-sheet";
import { ProfileActionsMenu } from "./profile-actions-menu";
import { ProfileInlineEditor } from "./profile-inline-editor";
import { ProfileAtAGlance } from "./profile-at-a-glance";
import { ProfileEmailSummary } from "./profile-email-summary";
import { simplifyHistoryText } from "./history-summary";
import { latestProfileNote } from "./latest-profile-note";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
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
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ProfileDetailSheet({
  target,
  open,
  onOpenChange,
  variant = "sheet",
}: {
  target: ProfileSheetTarget | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  variant?: "sheet" | "inline";
}) {
  const [data, setData] = useState<any>(null);
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

  const loadProfile = useCallback(
    async (reset = false) => {
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
        const [next] = await Promise.all([
          apiGet<any>(
            `/event-profiles/${profileId}${qs.toString() ? `?${qs.toString()}` : ""}`,
          ),
        ]);
        setData(next);
        setOptimisticRecentNote((current: any) => {
          if (!current) return current;
          const refreshedNotes = Array.isArray(next?.notes) ? next.notes : [];
          return refreshedNotes.some((note: any) => note.id === current.id)
            ? null
            : current;
        });
      } catch (cause: any) {
        setError(cause?.message ?? "Could not load profile");
      } finally {
        setLoading(false);
      }
    },
    [open, profileId, target?.contactId],
  );

  useEffect(() => {
    void loadProfile(true);
  }, [loadProfile]);

  async function handleInlineSaved() {
    await loadProfile(false);
    setEditing(false);
  }

  const title = useMemo(
    () =>
      data?.place?.name ?? data?.organization?.name ?? data?.name ?? "Profile",
    [data],
  );
  if (!target || !profileId) return null;

  const place = data?.place ?? {};
  const contacts = Array.isArray(data?.contacts) ? data.contacts : [];
  const notes = Array.isArray(data?.notes) ? data.notes : [];
  const bookings = Array.isArray(data?.bookings) ? data.bookings : [];
  const followUps = Array.isArray(data?.followUps) ? data.followUps : [];
  const selectedContactId =
    target.contactId ??
    data?.selectedContactId ??
    contacts.find((contact: any) => contact.isPrimary)?.id ??
    contacts[0]?.id ??
    null;
  const selectedContact =
    contacts.find((contact: any) => contact.id === selectedContactId) ??
    contacts[0] ??
    null;
  const location = [place.city, place.region].filter(Boolean).join(", ");
  const fullAddress = [
    [place.address1, place.address2].filter(Boolean).join(", "),
    [place.city, place.region, place.postalCode].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" · ");
  const recentNote = optimisticRecentNote ?? latestProfileNote(notes);
  const openFollowUps = [...followUps]
    .filter((item: any) => !item.completedAt)
    .sort(
      (a: any, b: any) =>
        new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime(),
    );
  const nextFollowUp = openFollowUps[0] ?? null;
  const followUpOverdue = Boolean(
    nextFollowUp && new Date(nextFollowUp.dueAt).getTime() < Date.now(),
  );
  const visiblePhone = selectedContact?.phone ?? place.phone ?? null;
  const phoneText = formatPhoneDisplay(visiblePhone);
  const callQuery = new URLSearchParams({ organizationId: profileId });
  if (selectedContactId) callQuery.set("contactId", selectedContactId);
  const callHref = visiblePhone
    ? `/calls/workspace?${callQuery.toString()}`
    : null;
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
      setNoteError(
        cause instanceof Error ? cause.message : "Could not save note.",
      );
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
      variant={variant}
    >
      {loading && !data ? (
        <p className="text-sm text-[#536064]">Loading profile…</p>
      ) : error && !data ? (
        <p className="rounded-md border border-[#e8aa93] bg-[#fff0ea] p-3 text-sm text-[#a63f35]">
          {error}
        </p>
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
              {recentNote ? (
                <Card data-testid="profile-sheet-latest-note">
                  <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                    <CardTitle>Latest note</CardTitle>
                    <span className="text-xs text-muted-foreground">{recentNote.historicalDateUnknown ? "Historical date not recorded" : formatDate(recentNote.occurredAt ?? recentNote.createdAt)}</span>
                  </CardHeader>
                  <CardContent>
                    <p className={`whitespace-pre-wrap break-words text-sm leading-6 ${recentNoteExpanded ? "" : "line-clamp-4"}`}>
                      {simplifyHistoryText(recentNote.body ?? "")}
                    </p>
                    {simplifyHistoryText(recentNote.body ?? "").length > 220 ? (
                      <Button variant="ghost" size="sm" className="mt-2" onClick={() => setRecentNoteExpanded(current => !current)}>
                        {recentNoteExpanded ? "Show less" : "More"}
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}
              <ProfileAtAGlance profile={data} />
              {!nextFollowUp ? (
                <section className="rounded-md border border-[#8fc9bf] bg-[#eaf6f3] p-4">
                  <p className="font-bold text-[#0f5f5c]">
                    ✓ No open follow-up records
                  </p>
                  <p className="mt-1 text-sm text-[#32765a]">
                    Check the next action above for opportunity work.
                  </p>
                </section>
              ) : followUpOverdue ? (
                <section className="rounded-md border border-[#e8aa93] bg-[#fff0ea] p-4">
                  <p className="font-bold text-[#a63f35]">Follow-up overdue</p>
                  <p className="mt-1 text-sm capitalize text-[#bc3e20]">
                    {String(nextFollowUp.kind ?? "follow-up").replaceAll(
                      "_",
                      " ",
                    )}{" "}
                    · {formatDateTime(nextFollowUp.dueAt)}
                  </p>
                </section>
              ) : (
                <section className="rounded-md border border-[#e7c978] bg-[#fff8df] p-4">
                  <p className="font-bold text-[#7a5710]">Follow-up needed</p>
                  <p className="mt-1 text-sm capitalize text-[#8a6518]">
                    {String(nextFollowUp.kind ?? "follow-up").replaceAll(
                      "_",
                      " ",
                    )}{" "}
                    · {formatDateTime(nextFollowUp.dueAt)}
                  </p>
                </section>
              )}

              <section className="rounded-md border border-[#d8d1c4] bg-[#fffefa]">
                <div className="flex items-start gap-3 border-b border-[#e6dfd2] p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="inline-flex items-center gap-1 font-bold text-[#182225]">
                          <MapPin className="h-4 w-4 shrink-0 text-[#157d78]" />
                          {location || "Location not set"}
                        </p>
                        {fullAddress ? (
                          <p className="mt-1 text-sm text-[#536064]">
                            {fullAddress}
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {place.placeType ? (
                            <span className="rounded-full bg-[#eaf6f3] px-2 py-0.5 text-xs font-semibold capitalize text-[#0f5f5c]">
                              {String(place.placeType).replaceAll("_", " ")}
                            </span>
                          ) : null}
                          {place.lastResort ? (
                            <span className="rounded-full bg-[#fff0ea] px-2 py-0.5 text-xs font-semibold text-[#a63f35]">
                              Last Resort
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <button
                        className="button-secondary shrink-0"
                        onClick={() => setEditing(true)}
                        type="button"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 px-4 py-4">
                  {callHref ? (
                    <Link
                      aria-label={
                        phoneText
                          ? `Open call workspace for ${phoneText}`
                          : "Open call workspace"
                      }
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#d8d1c4] bg-white text-[#536064] hover:border-[#157d78] hover:text-[#157d78]"
                      href={callHref}
                    >
                      <Phone className="h-5 w-5" />
                    </Link>
                  ) : null}
                  {email ? (
                    <a
                      aria-label={`Email ${email}`}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#d8d1c4] bg-white text-[#536064] hover:border-[#157d78] hover:text-[#157d78]"
                      href={`mailto:${email}`}
                    >
                      <Mail className="h-5 w-5" />
                    </a>
                  ) : null}
                  {websiteHref ? (
                    <a
                      aria-label="Open website"
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#d8d1c4] bg-white text-[#536064] hover:border-[#157d78] hover:text-[#157d78]"
                      href={websiteHref}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      <ExternalLink className="h-5 w-5" />
                    </a>
                  ) : null}
                </div>

                <div className="mx-4 mb-4 grid grid-cols-2 divide-x divide-[#d8d1c4] rounded-md bg-[#f6f2e9] py-3 text-center">
                  <p className="text-sm font-bold text-[#182225]">
                    {contacts.length} contact{contacts.length === 1 ? "" : "s"}
                  </p>
                  <p className="text-sm font-bold text-[#182225]">
                    {bookings.length} booking{bookings.length === 1 ? "" : "s"}
                  </p>
                </div>
              </section>

              {noteComposerOpen ? (
                <section className="grid gap-2 rounded-md border border-[#8fc9bf] bg-[#eaf6f3] p-3">
                  <label className="grid gap-1 text-sm font-semibold text-[#536064]">
                    New note
                    <textarea
                      autoFocus
                      className="min-h-24 rounded-md border border-[#d8d1c4] bg-white px-3 py-2 font-normal"
                      value={noteBody}
                      onChange={(event) => setNoteBody(event.target.value)}
                    />
                  </label>
                  {noteError ? (
                    <p
                      className="text-sm font-semibold text-[#a63f35]"
                      role="alert"
                    >
                      {noteError}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <button
                      className="button-primary"
                      disabled={noteSaving || !noteBody.trim()}
                      onClick={() => void saveNote()}
                      type="button"
                    >
                      {noteSaving ? "Saving…" : "Save note"}
                    </button>
                    <button
                      className="button-secondary"
                      disabled={noteSaving}
                      onClick={() => {
                        setNoteComposerOpen(false);
                        setNoteBody("");
                        setNoteError("");
                      }}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </section>
              ) : null}

              <div
                className="grid grid-cols-2 gap-2 border-t border-[#d8d1c4] bg-[#fffefa] pt-3"
                data-testid="profile-action-flow"
              >
                <button
                  className="button-primary"
                  onClick={openNoteComposer}
                  type="button"
                >
                  Add note
                </button>
                <ProfileActionsMenu
                  profileId={profileId}
                  contactId={selectedContactId}
                  showAddNote={false}
                />
              </div>
              <ProfileEmailSummary
                contacts={contacts}
                organizationId={profileId}
                organizationName={title}
              />
            </>
          )}
        </div>
      ) : null}
    </ResponsiveDetailSheet>
  );
}
