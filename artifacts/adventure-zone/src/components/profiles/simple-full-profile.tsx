import { useMemo, useState } from "react";
import { Camera, MapPin, MessageCircle, UserRound } from "lucide-react";

import { ActivityTimeline } from "@/components/activities/activity-timeline";
import { ProfileActionsMenu } from "@/components/profiles/profile-actions-menu";
import { ProfileInlineEditor } from "@/components/profiles/profile-inline-editor";
import { historyCategory, simplifyHistoryText } from "@/components/profiles/history-summary";
import {
  deleteActivityAction,
  editActivityAction,
  listActivityRevisionsAction,
  loadTimelinePageAction,
} from "@/actions/activities";
import type { EventProfile } from "@/features/event-profiles/event-profile-repository";
import { formatPhoneDisplay, phoneHref } from "@/features/contacts/phone-display";
import { normalizeExternalWebsite } from "@/features/organizations/website-url";

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Denver",
  }).format(date);
}

async function resizeProfilePhoto(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const next = new Image();
    next.onload = () => resolve(next);
    next.onerror = () => reject(new Error("Could not open that image."));
    next.src = source;
  });
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const sx = (image.naturalWidth - side) / 2;
  const sy = (image.naturalHeight - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 320;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare that image.");
  context.drawImage(image, sx, sy, side, side, 0, 0, 320, 320);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function statCard(value: number, label: string) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-center shadow-sm">
      <p className="text-2xl font-bold text-slate-950">{value}</p>
      <p className="mt-1 text-sm text-slate-600">{label}</p>
    </div>
  );
}

export function SimpleFullProfile({
  profile,
  onProfileSaved,
  ratingSummary,
  onAskAssistant,
  profileImageDataUrl,
  onProfileImageChange,
}: {
  profile: EventProfile;
  onProfileSaved?: () => Promise<void> | void;
  ratingSummary?: { average: number | null; count: number };
  onAskAssistant?: () => void;
  profileImageDataUrl?: string | null;
  onProfileImageChange?: (dataUrl: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const primaryContact = profile.contacts.find((contact) => contact.isPrimary) ?? profile.contacts[0] ?? null;
  const websiteHref = normalizeExternalWebsite(profile.place.website);
  const location = [profile.place.city, profile.place.region].filter(Boolean).join(", ");
  const meaningfulNotes = useMemo(() => profile.notes.filter((note) => historyCategory(note) !== "system"), [profile.notes]);
  const openFollowUps = useMemo(() => [...profile.followUps]
    .filter((item) => !item.completedAt && item.dueAt)
    .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime()), [profile.followUps]);
  const nextFollowUp = openFollowUps[0] ?? null;
  const followUpOverdue = Boolean(nextFollowUp && nextFollowUp.dueAt.getTime() < Date.now());
  const visiblePhone = primaryContact?.phone ?? profile.place.phone ?? null;
  const phoneText = formatPhoneDisplay(visiblePhone);
  const phoneLink = phoneHref(visiblePhone);
  const average = ratingSummary?.average ?? 0;
  const ratingCount = ratingSummary?.count ?? 0;
  const filledStars = ratingCount ? Math.max(0, Math.min(5, Math.round(average))) : 0;
  const stars = `${"★".repeat(filledStars)}${"☆".repeat(5 - filledStars)}`;

  async function loadSimpleNotesPage(page: number) {
    const result = await loadTimelinePageAction({ organizationId: profile.id }, page);
    if (!result.ok) return result;
    return {
      ...result,
      items: result.items
        .filter((item) => historyCategory(item) !== "system")
        .map((item) => ({ ...item, body: simplifyHistoryText(item.body) })),
    };
  }

  async function handleSaved() {
    await onProfileSaved?.();
    setEditing(false);
  }

  async function changePhoto(file: File | undefined) {
    if (!file || !onProfileImageChange) return;
    if (!file.type.startsWith("image/")) { setPhotoError("Choose an image file."); return; }
    setPhotoBusy(true);
    setPhotoError("");
    try {
      await onProfileImageChange(await resizeProfilePhoto(file));
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Could not save profile photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    if (!onProfileImageChange || photoBusy) return;
    setPhotoBusy(true);
    setPhotoError("");
    try { await onProfileImageChange(null); }
    catch (error) { setPhotoError(error instanceof Error ? error.message : "Could not remove profile photo."); }
    finally { setPhotoBusy(false); }
  }

  if (editing) {
    return <ProfileInlineEditor profile={profile as any} contactId={primaryContact?.id ?? null} onSaved={handleSaved} onCancel={() => setEditing(false)} />;
  }

  const activities = meaningfulNotes.map((note) => ({
    id: note.id,
    organizationId: profile.id,
    contactId: note.contactId,
    bookingId: note.bookingId,
    kind: note.kind as any,
    body: simplifyHistoryText(note.body),
    occurredAt: note.occurredAt instanceof Date ? note.occurredAt : new Date(note.occurredAt),
    createdAt: note.createdAt instanceof Date ? note.createdAt : new Date(note.createdAt),
    updatedAt: note.updatedAt instanceof Date ? note.updatedAt : new Date(note.updatedAt),
    revisionCount: 0,
    callOutcome: null,
    hasLinkedCallSession: false,
    importedFromAct: Boolean(note.importedFromAct),
    actSourceType: note.actSourceType === "note" || note.actSourceType === "history" || note.actSourceType === "activity" ? note.actSourceType : null,
  }));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap justify-end gap-2">
        <button className="button-secondary inline-flex items-center gap-2" type="button" onClick={onAskAssistant}>
          <MessageCircle className="h-4 w-4" /> Ask Assistant
        </button>
        <button className="button-secondary" onClick={() => setEditing(true)} type="button">Edit</button>
        <ProfileActionsMenu profileId={profile.id} contactId={primaryContact?.id ?? null} />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
          <div className="flex flex-col items-center gap-1">
            <label className="group relative block cursor-pointer" title="Change profile photo">
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={photoBusy} onChange={(event) => void changePhoto(event.target.files?.[0])} />
              {profileImageDataUrl ? (
                <img src={profileImageDataUrl} alt={`${profile.place.name} profile`} className="h-24 w-24 rounded-full border-2 border-white object-cover shadow-md sm:h-28 sm:w-28" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-orange-50 text-orange-700 shadow-inner sm:h-28 sm:w-28">
                  <UserRound className="h-10 w-10" />
                </div>
              )}
              <span className="absolute bottom-0 right-0 rounded-full border border-slate-200 bg-white p-1.5 shadow-sm"><Camera className="h-4 w-4" /></span>
            </label>
            {profileImageDataUrl ? <button className="text-xs font-medium text-slate-500 hover:text-rose-700" type="button" disabled={photoBusy} onClick={() => void removePhoto()}>Remove photo</button> : null}
          </div>

          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{profile.place.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              {location ? <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{location}</span> : null}
              {profile.place.placeType ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{profile.place.placeType.replaceAll("_", " ")}</span> : null}
              {profile.place.lastResort ? <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">Last Resort</span> : null}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {primaryContact ? <span className="font-semibold text-slate-800">{primaryContact.name}</span> : null}
              {phoneText && phoneLink ? <a className="font-medium text-slate-700 hover:text-orange-700" href={phoneLink}>{phoneText}</a> : null}
              {primaryContact?.email ? <a className="font-medium text-slate-700 hover:text-orange-700" href={`mailto:${primaryContact.email}`}>{primaryContact.email}</a> : null}
              {websiteHref ? <a className="font-medium text-slate-700 hover:text-orange-700" href={websiteHref} rel="noreferrer noopener" target="_blank">{profile.place.website}</a> : null}
            </div>
            {photoError ? <p className="mt-2 text-sm font-semibold text-rose-700" role="alert">{photoError}</p> : null}
          </div>

          <div className="min-w-40 md:text-right">
            <p className="text-xl font-bold text-slate-950">{average.toFixed(1)} <span className="text-sm font-medium text-slate-500">/ 5</span></p>
            <p className="mt-1 text-2xl tracking-wide text-orange-600" aria-label={`${filledStars} of 5 stars`}>{stars}</p>
            <p className="mt-1 text-sm text-slate-500">{ratingCount} rated occurrence{ratingCount === 1 ? "" : "s"}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,0.75fr))_minmax(0,2.2fr)]">
        {statCard(profile.contacts.length, `Contact${profile.contacts.length === 1 ? "" : "s"}`)}
        {statCard(profile.bookings.length, `Event${profile.bookings.length === 1 ? "" : "s"}`)}
        {statCard(meaningfulNotes.length, `Note${meaningfulNotes.length === 1 ? "" : "s"}`)}
        {!nextFollowUp ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <p className="font-bold text-emerald-900">No open follow-ups</p>
            <p className="mt-1 text-sm text-emerald-800">You’re all caught up!</p>
          </div>
        ) : followUpOverdue ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
            <p className="font-bold text-rose-900">Follow-up overdue</p>
            <p className="mt-1 text-sm capitalize text-rose-800">{nextFollowUp.kind.replaceAll("_", " ")} · {formatDateTime(nextFollowUp.dueAt)}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <p className="font-bold text-amber-900">Follow-up needed</p>
            <p className="mt-1 text-sm capitalize text-amber-800">{nextFollowUp.kind.replaceAll("_", " ")} · {formatDateTime(nextFollowUp.dueAt)}</p>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,2fr)]">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold">About</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div><dt className="font-semibold text-slate-500">Address</dt><dd className="mt-1 whitespace-pre-line text-slate-800">{[profile.place.address1, profile.place.address2, [profile.place.city, profile.place.region, profile.place.postalCode].filter(Boolean).join(" ")].filter(Boolean).join("\n") || "Not set"}</dd></div>
            <div><dt className="font-semibold text-slate-500">Category</dt><dd className="mt-1 capitalize text-slate-800">{profile.place.placeType?.replaceAll("_", " ") || "Other"}</dd></div>
            {profile.familyContext ? <div><dt className="font-semibold text-slate-500">Group</dt><dd className="mt-1 text-slate-800">{profile.familyContext.name}</dd></div> : null}
          </dl>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Activity timeline</h2><span className="text-xs text-slate-500">America/Denver</span></div>
          <div className="mt-4">
            <ActivityTimeline
              activities={activities}
              editActivity={editActivityAction}
              deleteActivity={deleteActivityAction}
              loadRevisions={listActivityRevisionsAction}
              loadPage={loadSimpleNotesPage}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
