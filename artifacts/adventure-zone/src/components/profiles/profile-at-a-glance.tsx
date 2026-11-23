import { CalendarDays, Mail, Phone, StickyNote, UserRound } from "lucide-react";
import { ProfileEventDateReview } from "./profile-event-date-review";

type AtAGlanceProfile = {
  place: {
    name?: string;
    applicationDeadline?: string | null;
    recommendedDealModel?: "flat_fee" | "pay_per_play" | "either" | null;
  };
  contacts: Array<{
    id: string;
    name: string;
    isPrimary?: boolean;
    email?: string | null;
    phone?: string | null;
  }>;
  bookings: Array<{
    id?: string;
    startsAt?: Date | string | null;
    status?: string | null;
  }>;
  effectiveEventDate?: {
    startsOn: string;
    endsOn: string | null;
    displayStatus: "booked" | "confirmed" | "expected";
    sourceId: string;
  } | null;
  eventDateFacts?: Array<{
    id: string;
    startsOn?: string | null;
    status?: string | null;
    sourceTitle?: string | null;
    sourceUrl?: string | null;
    sourceRecordType?: string | null;
    sourceRecordId?: string | null;
  }>;
  followUps?: Array<unknown>;
  notes?: Array<{
    id: string;
    kind?: string | null;
    body: string;
    occurredAt: Date | string;
  }>;
  decisionSummary?: {
    priority?: string | null;
    pipelineStatus?: string | null;
    nextActionKind?: string | null;
    nextActionDueAt?: Date | string | null;
  };
};

export const dealModelLabels = {
  flat_fee: "Flat fee",
  pay_per_play: "Pay-per-play",
  either: "Either",
} as const;

const dealModelCopy = {
  flat_fee: {
    label: "Flat fee",
    detail:
      "The organizer pays The Adventure Zone a guaranteed amount to appear.",
  },
  pay_per_play: {
    label: "Pay-per-play",
    detail:
      "The Adventure Zone sets up without an appearance fee and pays the organizer an agreed percentage of ticket sales. Recommend primarily for proven high-attendance shows.",
  },
  either: {
    label: "Either",
    detail:
      "Both structures are reasonable; attendance and organizer budget decide the final choice.",
  },
} as const;

function readable(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateValue(value: Date | string | null | undefined) {
  if (!value) return null;
  const date =
    value instanceof Date
      ? value
      : new Date(
          /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value,
        );
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: Date | string | null | undefined) {
  const date = dateValue(value);
  return date
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(date)
    : null;
}

export function ProfileAtAGlance({
  profile,
  now = new Date(),
  allowDateManagement = true,
  profileId,
  onDatesChanged,
}: {
  profile: AtAGlanceProfile;
  now?: Date;
  allowDateManagement?: boolean;
  profileId?: string;
  onDatesChanged?: () => Promise<void> | void;
}) {
  const nextEvent = profile.effectiveEventDate ?? null;
  const nextEventLabel = nextEvent
    ? `${nextEvent.displayStatus === "expected" ? "Estimated" : readable(nextEvent.displayStatus)} ${formatDate(nextEvent.startsOn)}${nextEvent.endsOn ? `–${formatDate(nextEvent.endsOn)}` : ""}`
    : "Upcoming date not recorded";
  const today = now.toISOString().slice(0, 10);
  const lastRecordedDate = !nextEvent
    ? [
        ...profile.bookings
          .filter(
            (booking) =>
              !["cancelled", "declined"].includes(booking.status ?? ""),
          )
          .map((booking) =>
            dateValue(booking.startsAt)?.toISOString().slice(0, 10),
          ),
        ...(profile.eventDateFacts ?? [])
          .filter((fact) =>
            ["confirmed", "expected"].includes(fact.status ?? ""),
          )
          .map((fact) => fact.startsOn),
      ]
        .filter((date): date is string => Boolean(date && date < today))
        .sort()
        .at(-1)
    : null;
  const dateFact =
    nextEvent && nextEvent.displayStatus !== "booked"
      ? profile.eventDateFacts?.find((fact) => fact.id === nextEvent.sourceId)
      : null;
  const primaryContact =
    profile.contacts.find((contact) => contact.isPrimary) ?? null;
  const displayContact =
    primaryContact ??
    profile.contacts.find((contact) => contact.email || contact.phone) ??
    profile.contacts[0] ??
    null;
  const dealModel = profile.place.recommendedDealModel
    ? dealModelCopy[profile.place.recommendedDealModel]
    : null;
  const actionKind = readable(profile.decisionSummary?.nextActionKind);
  const actionDue = formatDate(profile.decisionSummary?.nextActionDueAt);
  const latestNote = [...(profile.notes ?? [])]
    .filter((note) => note.body?.trim() && note.kind !== "system")
    .sort(
      (left, right) =>
        (dateValue(right.occurredAt)?.getTime() ?? 0) -
        (dateValue(left.occurredAt)?.getTime() ?? 0),
    )[0];
  const noteText = latestNote?.body.replace(/\s+/g, " ").trim();
  const notePreview = noteText?.slice(0, 220);

  return (
    <section
      aria-labelledby="at-a-glance-heading"
      className="border-l-4 border-[#e85d35] bg-card px-4 py-5 text-foreground sm:px-7"
      data-testid="profile-detail-header"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
            Booking decision
          </p>
          <h2
            className="mt-1 text-lg font-bold text-foreground"
            id="at-a-glance-heading"
          >
            At a glance
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">Recorded facts and next steps</p>
      </div>

      <dl className="mt-4 flex flex-wrap gap-2" data-testid="glance-metrics">
        <div className="min-w-[190px] flex-1 rounded-md border border-border p-4">
          <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Next event date
          </dt>
          <dd className="mt-1 flex items-center gap-2 text-sm font-bold text-foreground">
            <CalendarDays className="h-4 w-4 text-primary" />
            {nextEventLabel}
          </dd>
          {dateFact && (dateFact.sourceUrl || allowDateManagement) ? (
            <dd className="mt-2 text-xs">
              <a
                className="font-semibold text-primary underline"
                href={
                  dateFact.sourceUrl ??
                  `/settings/event-date-coverage?search=${encodeURIComponent(profile.place.name ?? "")}`
                }
              >
                {dateFact.sourceUrl ? "View source" : "View evidence"}
              </a>
            </dd>
          ) : null}
          {!nextEvent ? (
            <dd className="mt-2 text-xs text-muted-foreground">
              {lastRecordedDate
                ? `Last recorded date: ${formatDate(lastRecordedDate)}. `
                : ""}
              {allowDateManagement ? <a
                className="font-semibold text-primary underline"
                href={`/settings/event-date-coverage?search=${encodeURIComponent(profile.place.name ?? "")}`}
              >
                Find next date
              </a> : null}
            </dd>
          ) : null}
        </div>
        {profile.place.applicationDeadline ? (
          <div className="min-w-[190px] flex-1 rounded-md border border-border p-4">
            <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Deadline
            </dt>
            <dd className="mt-1 text-sm font-bold text-foreground">
              {formatDate(profile.place.applicationDeadline)}
            </dd>
          </div>
        ) : null}
        {profile.decisionSummary?.priority ? (
          <div className="min-w-[190px] flex-1 rounded-md border border-border p-4">
            <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Fit / priority
            </dt>
            <dd className="mt-1 text-sm font-bold text-foreground">
              {readable(profile.decisionSummary.priority)}
            </dd>
          </div>
        ) : null}
        {profile.decisionSummary?.pipelineStatus ? (
          <div className="min-w-[190px] flex-1 rounded-md border border-border p-4">
            <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Pipeline status
            </dt>
            <dd className="mt-1 text-sm font-bold text-foreground">
              {readable(profile.decisionSummary.pipelineStatus)}
            </dd>
          </div>
        ) : null}
      </dl>

      {allowDateManagement && profileId ? <ProfileEventDateReview profileId={profileId} onApplied={onDatesChanged} bookingTakesPriority={nextEvent?.displayStatus === "booked"} /> : null}

      {dealModel ? (
        <div
          className="mt-5 flex items-center gap-4 rounded-md bg-[#182225] px-4 py-4 text-white"
          data-testid="deal-model-band"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#efb33f] text-lg font-extrabold text-[#3b3019]">
            $
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#bfc8ca]">
              Recommended deal model
            </p>
            <p className="text-xl font-extrabold">{dealModel.label}</p>
            <p className="mt-1 text-xs leading-5 text-[#d8dfe0]">
              {dealModel.detail}
            </p>
          </div>
        </div>
      ) : null}

      <div
        className="mt-5 grid gap-5 lg:grid-cols-2"
        data-testid="action-contact-columns"
      >
        {actionKind ? (
          <div className="rounded-md border-t-4 border-[#e85d35] bg-muted p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Next action
            </p>
            <p className="mt-1 text-sm font-bold text-foreground">
              {`${actionKind}${actionDue ? ` · Due ${actionDue}` : ""}`}
            </p>
          </div>
        ) : null}
        {displayContact ? (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              {primaryContact ? "Primary contact" : "Contact"}
            </p>
            <div className="mt-2 grid gap-2 text-sm text-primary">
              <span className="inline-flex items-center gap-2 font-bold">
                <UserRound className="h-4 w-4 text-primary" />
                {displayContact.name}
              </span>
              {displayContact.email ? (
                <a
                  className="inline-flex items-center gap-2 font-semibold hover:text-[#244f47]"
                  href={`mailto:${displayContact.email}`}
                >
                  <Mail className="h-4 w-4" />
                  {displayContact.email}
                </a>
              ) : null}
              {displayContact.phone ? (
                <a
                  className="inline-flex items-center gap-2 font-semibold hover:text-[#244f47]"
                  href={`tel:${displayContact.phone}`}
                >
                  <Phone className="h-4 w-4" />
                  {displayContact.phone}
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
        {notePreview ? (
          <div className="rounded-md bg-muted p-4 lg:col-span-2">
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              <StickyNote className="h-4 w-4" />
              Latest note
            </p>
            <p className="mt-2 text-sm leading-6 text-foreground">
              {notePreview}
              {(noteText?.length ?? 0) > 220 ? "…" : ""}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

