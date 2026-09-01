import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Building2,
  Camera,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  Globe2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Sparkles,
  StickyNote,
  X,
  UsersRound,
} from "lucide-react";

import { ActivityTimeline } from "@/components/activities/activity-timeline";
import { ProfileGoogleEmailPanel } from "@/components/google-workspace/profile-google-email-panel";
import { ProfileActionsMenu } from "@/components/profiles/profile-actions-menu";
import { ProfileInlineEditor } from "@/components/profiles/profile-inline-editor";
import { historyCategory, simplifyHistoryText } from "@/components/profiles/history-summary";
import { mergeOptimisticActivities } from "@/components/profiles/profile-note-display";
import {
  createActivityAction,
  deleteActivityAction,
  editActivityAction,
  listActivityRevisionsAction,
  loadTimelinePageAction,
} from "@/actions/activities";
import { getGoogleProfileEmails } from "@/features/google-workspace/google-workspace-client";
import type { ActivityTimelineItem } from "@/features/activities/activity-types";
import type { GoogleProfileEmailConversation } from "@/features/google-workspace/google-workspace-client";
import type { EventProfile } from "@/features/event-profiles/event-profile-repository";
import { formatPhoneDisplay } from "@/features/contacts/phone-display";
import { normalizeExternalWebsite } from "@/features/organizations/website-url";
import { getPaperNoteActivitySource } from "@/features/paper-notes/paper-note-client";

type OpenSection = "contacts" | "events" | "notes" | "emails" | null;

function formatShortDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Denver",
  }).format(date);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "AZ";
}

function StatCard({
  icon,
  value,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  value: number;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={active}
      aria-pressed={active}
      className={`group rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-ring ${
        active
          ? "border-primary/30 bg-secondary"
          : "border-border bg-card hover:border-primary/30 hover:bg-secondary/60"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary">
        {icon}
      </span>
      <span className="block text-2xl font-bold tracking-tight text-[#173b48]">{value}</span>
      <span className="mt-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#72858a]">
        {label}
        <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
      </span>
    </button>
  );
}

export function SimpleFullProfile({
  profile,
  onProfileSaved,
  ratingSummary,
  onAskAssistant,
  onBack,
  originLabel = "Profiles",
  profileImageDataUrl,
  onProfileImageChange,
  editing,
  onEditingChange,
}: {
  profile: EventProfile;
  onProfileSaved?: () => Promise<void> | void;
  ratingSummary?: { average: number | null; count: number };
  onAskAssistant?: () => void;
  onBack?: () => void;
  originLabel?: string;
  profileImageDataUrl?: string | null;
  onProfileImageChange?: (dataUrl: string | null) => Promise<void>;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [internalEditing, setInternalEditing] = useState(false);
  const [openSection, setOpenSection] = useState<OpenSection>(() =>
    profile.bookings.length ? "events" : null,
  );
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [noteSearch, setNoteSearch] = useState("");
  const [noteComposerOpen, setNoteComposerOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [optimisticActivities, setOptimisticActivities] = useState<ActivityTimelineItem[]>([]);
  const [emailConversations, setEmailConversations] = useState<GoogleProfileEmailConversation[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [primaryContactOpen, setPrimaryContactOpen] = useState(false);
  const isEditing = editing ?? internalEditing;

  useEffect(() => {
    setOptimisticActivities([]);
  }, [profile.id]);

  useEffect(() => {
    setOpenSection(profile.bookings.length ? "events" : null);
  }, [profile.id, profile.bookings.length]);

  useEffect(() => {
    let active = true;
    setEmailConversations([]);
    void getGoogleProfileEmails(profile.id)
      .then((result) => {
        if (active) setEmailConversations(result.conversations);
      })
      .catch(() => {
        if (active) setEmailConversations([]);
      });
    return () => {
      active = false;
    };
  }, [profile.id]);

  const primaryContact =
    profile.contacts.find((contact) => contact.isPrimary) ?? profile.contacts[0] ?? null;
  const websiteHref = normalizeExternalWebsite(profile.place.website);
  const location = [profile.place.city, profile.place.region].filter(Boolean).join(", ");
  const meaningfulNotes = useMemo(
    () => profile.notes.filter((note) => historyCategory(note) !== "system"),
    [profile.notes],
  );
  const openFollowUps = useMemo(
    () =>
      [...profile.followUps]
        .filter((item) => !item.completedAt && item.dueAt)
        .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime()),
    [profile.followUps],
  );
  const nextFollowUp = openFollowUps[0] ?? null;
  const followUpOverdue = Boolean(nextFollowUp && nextFollowUp.dueAt.getTime() < Date.now());
  const average = ratingSummary?.average ?? 0;
  const ratingCount = ratingSummary?.count ?? 0;
  const filledStars = ratingCount ? Math.max(0, Math.min(5, Math.round(average))) : 0;
  const stars = `${"★".repeat(filledStars)}${"☆".repeat(5 - filledStars)}`;
  const persistedActivities: ActivityTimelineItem[] = meaningfulNotes.map((note) => ({
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
    actSourceType:
      note.actSourceType === "note" ||
      note.actSourceType === "history" ||
      note.actSourceType === "activity"
        ? note.actSourceType
        : null,
    historicalDateUnknown: Boolean((note as any).historicalDateUnknown),
    paperNoteSource: (note as any).paperNoteSource ?? null,
  }));
  const activities = mergeOptimisticActivities(persistedActivities, optimisticActivities);
  const emailCount = emailConversations.length;
  const recentHistory = [
    ...activities.map((activity) => ({
      id: activity.id,
      kind: activity.kind,
      body: activity.body,
      occurredAt: activity.occurredAt,
    })),
    ...emailConversations.map((conversation) => ({
      id: `gmail:${conversation.threadId}`,
      kind: "email",
      body: conversation.subject || "(No subject)",
      occurredAt: new Date(
        (conversation.internalDateMs ?? Date.parse(conversation.date)) || 0,
      ),
    })),
  ].sort(
    (left, right) =>
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime() ||
      left.id.localeCompare(right.id),
  );
  const normalizedSearch = noteSearch.trim().toLowerCase();
  const filteredActivities = normalizedSearch
    ? activities.filter((item) => `${item.kind} ${item.body}`.toLowerCase().includes(normalizedSearch))
    : activities;

  function setEditing(next: boolean) {
    if (editing === undefined) setInternalEditing(next);
    onEditingChange?.(next);
  }

  function toggleSection(section: Exclude<OpenSection, null>) {
    setOpenSection((current) => (current === section ? null : section));
  }

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

  async function openOriginalPaperNote(activityId: string) {
    const source = await getPaperNoteActivitySource(activityId);
    if (!source.url) throw new Error("The original paper note image is not available.");
    window.open(source.url, "_blank", "noopener,noreferrer");
  }

  async function changePhoto(file: File | undefined) {
    if (!file || !onProfileImageChange) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Choose an image file.");
      return;
    }
    setPhotoBusy(true);
    setPhotoError("");
    try {
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
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 320;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare that image.");
      context.drawImage(
        image,
        (image.naturalWidth - side) / 2,
        (image.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        320,
        320,
      );
      await onProfileImageChange(canvas.toDataURL("image/jpeg", 0.82));
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
    try {
      await onProfileImageChange(null);
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Could not remove profile photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  function openNoteComposer() {
    setNoteError("");
    setOpenSection("notes");
    setNoteComposerOpen(true);
  }

  async function saveNote() {
    const body = noteBody.trim();
    if (!body || noteSaving) return;
    setNoteSaving(true);
    setNoteError("");
    try {
      const result = await createActivityAction({
        organizationId: profile.id,
        contactId: primaryContact?.id ?? undefined,
        kind: "note",
        body,
        occurredAt: new Date(),
      });
      if (!result.ok) {
        setNoteError(result.error);
        return;
      }
      setOptimisticActivities((current) => [
        result.activity,
        ...current.filter((activity) => activity.id !== result.activity.id),
      ]);
      setNoteBody("");
      setNoteComposerOpen(false);
      await onProfileSaved?.();
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : "Could not save note.");
    } finally {
      setNoteSaving(false);
    }
  }

  if (isEditing) {
    return (
      <ProfileInlineEditor
        profile={profile as any}
        contactId={primaryContact?.id ?? null}
        onSaved={async () => {
          await onProfileSaved?.();
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const address = [
    [profile.place.address1, profile.place.address2].filter(Boolean).join(", "),
    [profile.place.city, profile.place.region, profile.place.postalCode].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const callQuery = new URLSearchParams({ organizationId: profile.id });
  if (primaryContact?.id) callQuery.set("contactId", primaryContact.id);
  const visiblePhone = primaryContact?.phone ?? profile.place.phone ?? null;
  const callHref = visiblePhone ? `/calls/new?${callQuery.toString()}` : null;

  return (
    <div className="profile-modern grid gap-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-sm">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#173b48] text-sm font-bold tracking-tight text-[#f8f5ee]">
            AZ
          </div>
          <div>
            <p className="font-bold tracking-tight text-[#173b48]">Adventure Zone</p>
            <p className="text-xs text-[#71848a]">Relationships / {originLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              aria-expanded={notificationsOpen}
              aria-label="Open notifications"
              className={`relative flex h-10 w-10 items-center justify-center rounded-lg border bg-card text-muted-foreground transition hover:border-primary/30 hover:text-foreground ${notificationsOpen ? "border-primary/30 bg-secondary text-primary" : "border-border"}`}
              onClick={() => {
                setNotificationsOpen((current) => !current);
                setPrimaryContactOpen(false);
              }}
              type="button"
            >
              <Bell className="h-4 w-4" />
              {nextFollowUp ? <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#d47e4d]" /> : null}
            </button>
            {notificationsOpen ? (
              <div className="absolute right-0 top-12 z-30 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[#d8e2dd] bg-[#fbfcf8] shadow-[0_18px_40px_rgba(23,59,72,0.16)]" role="dialog" aria-label="Notifications">
                <div className="flex items-start justify-between gap-4 border-b border-[#e4ebe5] px-4 py-3">
                  <div>
                    <p className="text-sm font-bold text-[#173b48]">Notifications</p>
                    <p className="mt-0.5 text-xs text-[#839596]">{nextFollowUp ? "One item needs your attention" : "You are all caught up"}</p>
                  </div>
                  <button aria-label="Close notifications" className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary" onClick={() => setNotificationsOpen(false)} type="button">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {nextFollowUp ? (
                  <div className="flex items-start gap-3 px-4 py-4">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#faecd9] text-[#a66845]"><Bell className="h-4 w-4" /></span>
                    <div>
                      <p className="text-sm font-bold text-[#315b66]">Follow-up due {followUpOverdue ? "now" : "soon"}</p>
                      <p className="mt-1 text-sm leading-5 text-[#71848a]">Review the next action for {profile.place.name}.</p>
                      <button className="mt-3 text-xs font-bold text-primary hover:text-primary/80" onClick={() => { setNotificationsOpen(false); setOpenSection(null); }} type="button">Review follow-up <ArrowUpRight className="inline h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ) : <p className="px-4 py-4 text-sm text-[#71848a]">No open follow-ups.</p>}
              </div>
            ) : null}
          </div>
          {primaryContact ? (
            <div className="relative">
              <button
                aria-expanded={primaryContactOpen}
                aria-label={`Open primary contact ${primaryContact.name}`}
                className={`inline-flex h-10 items-center gap-2 rounded-lg border bg-[#fbfcf8] px-2.5 text-sm transition hover:border-[#a7beb3] sm:px-3 ${primaryContactOpen ? "border-[#9ab6a9] bg-[#edf4ef]" : "border-[#d8e2dd]"}`}
                onClick={() => {
                  setPrimaryContactOpen((current) => !current);
                  setNotificationsOpen(false);
                }}
                type="button"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#dbe9e4] text-[10px] font-bold text-[#397064]">{initials(primaryContact.name)}</span>
                <span className="hidden font-semibold text-[#526970] sm:inline">{primaryContact.name}</span>
                <ChevronDown className={`h-3.5 w-3.5 text-[#8ca0a2] transition-transform ${primaryContactOpen ? "rotate-180" : ""}`} />
              </button>
              {primaryContactOpen ? (
                <div className="absolute right-0 top-12 z-30 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[#d8e2dd] bg-[#fbfcf8] shadow-[0_18px_40px_rgba(23,59,72,0.16)]" role="dialog" aria-label={`Primary contact ${primaryContact.name}`}>
                  <div className="flex items-start gap-3 border-b border-[#e4ebe5] px-4 py-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#dbe9e4] text-xs font-bold text-[#397064]">{initials(primaryContact.name)}</span>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#75908b]">Primary contact</p>
                      <p className="mt-1 font-bold text-[#173b48]">{primaryContact.name}</p>
                      <p className="mt-0.5 text-sm text-[#71848a]">{primaryContact.role || "Contact"}</p>
                    </div>
                  </div>
                  <div className="grid gap-2 px-4 py-3">
                    {primaryContact.phone ? <a className="inline-flex items-center gap-2 rounded-lg bg-[#f1f6f2] px-3 py-2.5 text-sm font-semibold text-[#315b66]" href={`tel:${primaryContact.phone}`}><Phone className="h-4 w-4 text-[#397064]" />{formatPhoneDisplay(primaryContact.phone)}</a> : null}
                    {primaryContact.email ? <a className="inline-flex items-center gap-2 rounded-lg bg-[#f1f6f2] px-3 py-2.5 text-sm font-semibold text-[#315b66]" href={`mailto:${primaryContact.email}`}><Mail className="h-4 w-4 text-[#397064]" />{primaryContact.email}</a> : null}
                  </div>
                  <div className="border-t border-[#e4ebe5] px-4 py-3">
                    <Link className="button-primary inline-flex w-full items-center justify-center gap-2" href={`/contacts/${primaryContact.id}`}>
                      Open contact profile <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#789096]">
          {onBack ? (
            <button className="inline-flex items-center gap-1.5 text-[#60747a] hover:text-[#173b48]" onClick={onBack} type="button">
              <ArrowLeft className="h-3.5 w-3.5" /> {originLabel}
            </button>
          ) : <Link href="/profiles" className="hover:text-[#315b66]">{originLabel}</Link>}
          <span className="text-[#a8b5b4]">/</span>
          <span className="text-[#315b66]">{profile.place.name}</span>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <button
            className="button-secondary inline-flex flex-1 items-center justify-center gap-2 !border-[#cad9d3] !bg-[#fbfcf8] !text-[#315b66] sm:flex-none"
            onClick={onAskAssistant}
            type="button"
          >
            <Sparkles className="h-4 w-4 text-[#bf7048]" />
            Ask Assistant
          </button>
          <ProfileActionsMenu
            profileId={profile.id}
            contactId={primaryContact?.id ?? null}
            onAddNote={openNoteComposer}
            triggerLabel="More"
          />
        </div>
      </div>

      <section className="rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] shadow-[0_12px_32px_rgba(32,71,77,0.06)]">
        <div className="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="shrink-0">
              <label className="group relative block w-fit cursor-pointer" title="Change profile photo">
                <input
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={photoBusy}
                  onChange={(event) => void changePhoto(event.target.files?.[0])}
                />
                {profileImageDataUrl ? (
                  <img
                    src={profileImageDataUrl}
                    alt={`${profile.place.name} profile`}
                    className="h-16 w-16 rounded-xl border border-[#bfd5ca] object-cover sm:h-20 sm:w-20"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-[#bfd5ca] bg-[#e3eee8] text-lg font-bold text-[#397064] sm:h-20 sm:w-20">
                    {initials(profile.place.name)}
                  </div>
                )}
                <span className="absolute -bottom-2 -right-2 rounded-lg border border-[#d8e2dd] bg-[#fbfcf8] p-1.5 text-[#315b66] shadow-sm">
                  <Camera className="h-4 w-4" />
                </span>
              </label>
              {profileImageDataUrl ? (
                <button
                  className="mt-2 w-16 text-xs font-semibold text-[#71848a] hover:text-[#b8544f] sm:w-20"
                  disabled={photoBusy}
                  onClick={() => void removePhoto()}
                  type="button"
                >
                  Remove
                </button>
              ) : null}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-2xl font-bold tracking-[-0.03em] text-[#173b48] sm:text-3xl">
                  {profile.place.name}
                </h1>
                <span className="rounded-full bg-[#e2efe9] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[#397064]">
                  Active relationship
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#688087]">
                {location ? (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-[#4b8575]" />
                    {location}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1.5 capitalize">
                  <Building2 className="h-4 w-4 text-[#4b8575]" />
                  {profile.place.placeType?.replaceAll("_", " ") || "Organization"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-[#4b8575]" />
                  Verified details
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#71848a]">
                <span
                  className="inline-flex items-center gap-2"
                  aria-label={`${average.toFixed(1)} out of 5 stars from ${ratingCount} reviews`}
                >
                  <span className="tracking-[0.1em] text-[#d4874f]" aria-hidden="true">
                    {stars}
                  </span>
                  <span className="font-bold text-[#45616a]">{average.toFixed(1)}</span>
                  <span>({ratingCount} reviews)</span>
                </span>
                {websiteHref ? (
                  <a
                    className="inline-flex items-center gap-1.5 font-semibold text-[#397064] hover:text-[#244f47]"
                    href={websiteHref}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Visit website
                  </a>
                ) : null}
              </div>
              {photoError ? (
                <p className="mt-2 text-sm font-semibold text-[#b8544f]" role="alert">
                  {photoError}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {callHref ? (
              <Link className="button-secondary inline-flex items-center gap-2 !border-[#cad9d3] !bg-transparent !text-[#315b66]" href={callHref}>
                <Phone className="h-4 w-4" />
                Call
              </Link>
            ) : null}
            <button aria-label="Edit profile" className="button-secondary inline-flex items-center gap-2 !border-[#cad9d3] !bg-transparent !text-[#315b66]" onClick={() => setEditing(true)} type="button">Edit</button>
            <button
              className="button-primary inline-flex items-center gap-2"
              onClick={openNoteComposer}
              type="button"
            >
              <Plus className="h-4 w-4" />
              Add note
            </button>
          </div>
        </div>

        {profile.place.description?.trim() ? (
          <div className="border-t border-[#e1e8e3] px-4 py-4 sm:px-7">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#75908b]">About</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#4d666d]">
              {profile.place.description.trim()}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-[#e1e8e3] px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-7">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#75908b]">
              Organization record
            </p>
            <dl className="mt-2 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-3">
              <div>
                <dt className="font-semibold text-[#829696]">Address</dt>
                <dd className="mt-0.5 leading-5 text-[#4d666d]">{address || "Not recorded"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[#829696]">Organization group</dt>
                <dd className="mt-0.5 text-[#4d666d]">{profile.familyContext?.name || "Not grouped"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[#829696]">Relationship started</dt>
                <dd className="mt-0.5 text-[#4d666d]">Not recorded</dd>
              </div>
            </dl>
          </div>
          <span className="hidden shrink-0 items-center gap-1.5 pt-1 text-xs font-semibold text-[#809295] md:inline-flex">
            <Clock3 className="h-3.5 w-3.5" />
            Mountain Time (MT)
          </span>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={<UsersRound className="h-4 w-4" />}
          label={`Contacts`}
          value={profile.contacts.length}
          active={openSection === "contacts"}
          onClick={() => toggleSection("contacts")}
        />
        <StatCard
          icon={<CalendarDays className="h-4 w-4" />}
          label="Bookings"
          value={profile.bookings.length}
          active={openSection === "events"}
          onClick={() => toggleSection("events")}
        />
        <StatCard
          icon={<Mail className="h-4 w-4" />}
          label="Emails"
          value={emailCount}
          active={openSection === "emails"}
          onClick={() => toggleSection("emails")}
        />
      </section>

      {openSection === null ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.85fr)]">
          <div className="grid gap-5">
            <section className="rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)] sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Next action</p>
                  <h2 className="mt-1 text-xl font-bold tracking-tight text-[#173b48]">
                    {nextFollowUp ? "Follow up with this organization" : "All caught up"}
                  </h2>
                  <p className="mt-1 text-sm text-[#71848a]">
                    {nextFollowUp
                      ? "Keep the relationship moving with the next useful touchpoint."
                      : "No open follow-ups for this organization."}
                  </p>
                </div>
                {nextFollowUp ? (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${followUpOverdue ? "bg-[#f5dfdc] text-[#9b4e48]" : "bg-[#faecd9] text-[#9b633e]"}`}>
                    {followUpOverdue ? "Overdue" : `Due ${formatShortDate(nextFollowUp.dueAt) ?? "soon"}`}
                  </span>
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e2efe9] text-[#397064]">
                    <Check className="h-5 w-5" />
                  </span>
                )}
              </div>
              {nextFollowUp && primaryContact ? (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#e5ebe5] pt-4">
                  <div className="flex items-center gap-2 text-sm text-[#526970]">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#dbe9e4] text-xs font-bold text-[#397064]">
                      {initials(primaryContact.name)}
                    </span>
                    <span>
                      <span className="block text-xs text-[#87989a]">Primary contact</span>
                      <span className="font-semibold">{primaryContact.name}</span>
                    </span>
                  </div>
                  <ProfileActionsMenu profileId={profile.id} contactId={primaryContact.id} showAddNote={false} />
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)] sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Relationship activity</p>
                  <h2 className="mt-1 text-xl font-bold tracking-tight text-[#173b48]">Recent history</h2>
                </div>
                <button
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-[#397064] hover:text-[#244f47]"
                  onClick={() => setOpenSection("notes")}
                  type="button"
                >
                  View all
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-5 grid gap-4">
                {recentHistory.slice(0, 3).length ? (
                  recentHistory.slice(0, 3).map((activity) => (
                    <article className="flex gap-3" key={activity.id}>
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${activity.kind === "call" ? "bg-[#f5e6dc] text-[#a66845]" : "bg-[#e3eee8] text-[#397064]"}`}>
                        {activity.kind === "call" ? <Phone className="h-4 w-4" /> : activity.kind === "email" ? <Mail className="h-4 w-4" /> : <StickyNote className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1 border-b border-[#edf0eb] pb-4 last:border-0 last:pb-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#668078]">{activity.kind}</p>
                          <time className="text-xs text-[#8b9a9b]">{formatShortDate(activity.occurredAt)}</time>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-[#4d666d]">{activity.body}</p>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[#71848a]">No relationship activity has been recorded yet.</p>
                )}
              </div>
            </section>
          </div>

          <aside className="grid content-start gap-5">
            <section className="rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)]">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Relationship health</p>
                <span className="text-xs font-bold text-[#397064]">{ratingCount ? "Good standing" : "Not rated"}</span>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <span className="text-3xl font-bold tracking-tight text-[#173b48]">
                  {average.toFixed(1)} <span className="text-sm font-semibold text-[#849597]">/ 5</span>
                </span>
                <span className="text-xs text-[#849597]">{ratingCount} rated occurrence{ratingCount === 1 ? "" : "s"}</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e1e9e4]">
                <div className="h-full rounded-full bg-[#5d9583]" style={{ width: `${Math.min(100, Math.max(0, average * 20))}%` }} />
              </div>
              <p className="mt-3 text-sm leading-5 text-[#71848a]">
                Use recent history and follow-ups to keep this relationship moving with a steady cadence.
              </p>
            </section>
          </aside>
        </div>
      ) : null}

      {openSection === "contacts" ? (
        <section className="rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)] sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">People at this organization</p>
              <h2 className="mt-1 text-xl font-bold text-[#173b48]">Contacts</h2>
            </div>
            <Link className="button-primary inline-flex items-center gap-2" href="/contacts/new">
              <Plus className="h-4 w-4" />
              Add contact
            </Link>
          </div>
          {profile.contacts.length ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {profile.contacts.map((contact) => (
                <article className="rounded-xl border border-[#dce6e0] bg-[#f8faf6] p-4" key={contact.id}>
                  <div className="flex items-start justify-between gap-3">
                    <Link className="flex min-w-0 items-center gap-3" href={`/contacts/${contact.id}`}>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#dbe9e4] text-xs font-bold text-[#397064]">
                        {initials(contact.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-[#173b48]">{contact.name}</span>
                        <span className="block truncate text-sm text-[#71848a]">{contact.role || "Contact"}</span>
                      </span>
                    </Link>
                    {contact.isPrimary ? (
                      <span className="rounded-full bg-[#e2efe9] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#397064]">
                        Primary
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-4 text-xs font-semibold text-[#839596]">
                    {contact.phone || contact.email || "Contact details not recorded"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {contact.phone ? (
                      <a className="inline-flex items-center gap-1.5 rounded-md border border-[#d8e2dd] px-2.5 py-2 text-xs font-bold text-[#4f6a70] hover:border-[#9ab6a9]" href={`tel:${contact.phone}`}>
                        <Phone className="h-3.5 w-3.5" />
                        Call
                      </a>
                    ) : null}
                    {contact.email ? (
                      <a className="inline-flex items-center gap-1.5 rounded-md border border-[#d8e2dd] px-2.5 py-2 text-xs font-bold text-[#4f6a70] hover:border-[#9ab6a9]" href={`mailto:${contact.email}`}>
                        <Mail className="h-3.5 w-3.5" />
                        Email
                      </a>
                    ) : null}
                    <Link className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-primary hover:text-primary/80" href={`/contacts/${contact.id}`}>
                      Details
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[#71848a]">No contacts have been added yet.</p>
          )}
        </section>
      ) : null}

      {openSection === "events" ? (
        <section className="rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)] sm:p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Yearly booking records</p>
          <h2 className="mt-1 text-xl font-bold text-[#173b48]">Bookings & opportunities</h2>
          {profile.bookings.length ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {profile.bookings.map((booking) => (
                <Link className="group rounded-xl border border-[#dce6e0] bg-[#f8faf6] p-4 transition hover:border-[#9ab6a9] hover:bg-[#f3f8f3]" href={`/bookings/${booking.id}`} key={booking.id}>
                  <div className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block font-bold text-[#173b48]">{booking.name}</span>
                      <span className="mt-1 block text-sm text-[#71848a]">{booking.notes || "Booking context"}</span>
                    </span>
                    <span className="rounded-full bg-[#e2efe9] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#397064]">
                      {booking.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t border-[#e5ebe5] pt-3 text-sm">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-[#536e75]">
                      <CalendarDays className="h-4 w-4 text-[#4b8575]" />
                      {formatShortDate(booking.startsAt) || "Date not set"}
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-[#87a19a] opacity-0 transition group-hover:opacity-100" />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[#71848a]">No bookings have been added yet.</p>
          )}
        </section>
      ) : null}

      {openSection === "notes" ? (
        <section className="rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)] sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Relationship history</p>
              <h2 className="mt-1 text-xl font-bold text-[#173b48]">Activity history</h2>
            </div>
            <button className="button-primary inline-flex items-center gap-2" onClick={openNoteComposer} type="button">
              <Plus className="h-4 w-4" />
              Add note
            </button>
          </div>
          <label className="relative mt-5 block max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8da09d]" />
            <input
              aria-label="Search notes & history"
              className="w-full rounded-lg border border-[#d3e0d9] bg-[#f8faf6] py-2.5 pl-9 pr-3 text-sm text-[#173b48] outline-none transition focus:border-[#8eae9e] focus:ring-2 focus:ring-[#dcebe1]"
              placeholder="Search notes, calls, and outreach"
              value={noteSearch}
              onChange={(event) => setNoteSearch(event.target.value)}
            />
          </label>
          {noteComposerOpen ? (
            <div className="mt-4 rounded-xl border border-[#bfd5ca] bg-[#edf5ef] p-4">
              <label className="grid gap-2 text-sm font-bold text-[#315b66]">
                New note
                <textarea
                  autoFocus
                  className="min-h-24 rounded-lg border border-[#c8dcd0] bg-[#fbfcf8] px-3 py-2 font-normal text-[#173b48] outline-none focus:ring-2 focus:ring-[#d3e8da]"
                  value={noteBody}
                  onChange={(event) => setNoteBody(event.target.value)}
                />
              </label>
              {noteError ? <p className="mt-2 text-sm font-semibold text-[#b8544f]" role="alert">{noteError}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="button-primary" disabled={noteSaving || !noteBody.trim()} onClick={() => void saveNote()} type="button">
                  {noteSaving ? "Saving…" : "Save note"}
                </button>
                <button className="button-secondary !bg-transparent" disabled={noteSaving} onClick={() => { setNoteComposerOpen(false); setNoteBody(""); }} type="button">
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          <div className="mt-6">
            {normalizedSearch && filteredActivities.length === 0 ? (
              <p className="rounded-xl bg-[#f4f8f4] p-4 text-sm text-[#71848a]">No notes or history match “{noteSearch.trim()}”.</p>
            ) : (
              <ActivityTimeline
                activities={filteredActivities}
                editActivity={editActivityAction}
                deleteActivity={deleteActivityAction}
                loadRevisions={listActivityRevisionsAction}
                loadPage={normalizedSearch ? undefined : loadSimpleNotesPage}
                openPaperNoteSource={openOriginalPaperNote}
                collapseLongBodies
              />
            )}
          </div>
        </section>
      ) : null}

      {openSection === "emails" ? <ProfileGoogleEmailPanel organizationId={profile.id} /> : null}

      <section className="rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)] sm:p-6">
        <div className="flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-[#4b8575]" />
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-[#75908b]">About this organization</h2>
        </div>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="font-semibold text-[#829696]">Description</dt>
            <dd className="mt-1 whitespace-pre-wrap leading-6 text-[#4d666d]">{(profile.place as any).description || "No description recorded."}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[#829696]">Office phone</dt>
            <dd className="mt-1 text-[#4d666d]">{formatPhoneDisplay(profile.place.phone) || "Not recorded"}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[#829696]">Website</dt>
            <dd className="mt-1 break-all text-[#4d666d]">{profile.place.website || "Not recorded"}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
