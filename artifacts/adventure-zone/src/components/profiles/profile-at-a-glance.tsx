import { CalendarDays, Mail, Phone, UserRound } from "lucide-react";

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
  followUps?: Array<unknown>;
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
}: {
  profile: AtAGlanceProfile;
  now?: Date;
}) {
  const today = new Date(
    `${now.toISOString().slice(0, 10)}T00:00:00Z`,
  ).getTime();
  const nextEvent =
    profile.bookings
      .filter(
        (booking) => !["cancelled", "declined"].includes(booking.status ?? ""),
      )
      .map((booking) => dateValue(booking.startsAt))
      .filter((date): date is Date => date !== null && date.getTime() >= today)
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
  const primaryContact =
    profile.contacts.find((contact) => contact.isPrimary) ?? null;
  const dealModel = profile.place.recommendedDealModel
    ? dealModelCopy[profile.place.recommendedDealModel]
    : null;
  const actionKind = readable(profile.decisionSummary?.nextActionKind);
  const actionDue = formatDate(profile.decisionSummary?.nextActionDueAt);

  return (
    <section
      aria-labelledby="at-a-glance-heading"
      className="bg-[#fffefa] px-4 py-5 sm:px-7"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9b633e]">
            Booking decision
          </p>
          <h2
            className="mt-1 text-lg font-bold text-[#173b48]"
            id="at-a-glance-heading"
          >
            At a glance
          </h2>
        </div>
        <p className="text-xs text-[#71848a]">Only recorded facts are shown.</p>
      </div>

      <dl
        className="mt-4 grid overflow-hidden rounded-md border border-[#ccc5b8] sm:grid-cols-2 lg:grid-cols-4"
        data-testid="glance-metrics"
      >
        <div className="border-b border-[#ddd6ca] p-4 sm:border-r">
          <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6d777a]">
            Next event date
          </dt>
          <dd className="mt-1 flex items-center gap-2 text-sm font-bold text-[#182225]">
            <CalendarDays className="h-4 w-4 text-[#397064]" />
            {formatDate(nextEvent) ?? "Date not published"}
          </dd>
        </div>
        <div className="border-b border-[#ddd6ca] p-4 lg:border-r">
          <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6d777a]">
            Deadline
          </dt>
          <dd className="mt-1 text-sm font-bold text-[#182225]">
            {formatDate(profile.place.applicationDeadline) ??
              "No deadline recorded"}
          </dd>
        </div>
        <div className="border-b border-[#ddd6ca] p-4 sm:border-b-0 sm:border-r">
          <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6d777a]">
            Fit / priority
          </dt>
          <dd className="mt-1 text-sm font-bold text-[#182225]">
            {readable(profile.decisionSummary?.priority) ?? "Not recorded"}
          </dd>
        </div>
        <div className="p-4">
          <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6d777a]">
            Pipeline status
          </dt>
          <dd className="mt-1 text-sm font-bold text-[#182225]">
            {readable(profile.decisionSummary?.pipelineStatus) ??
              "Not recorded"}
          </dd>
        </div>
      </dl>

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
          <p className="text-xl font-extrabold">
            {dealModel?.label ?? "No recommendation recorded"}
          </p>
          {dealModel ? (
            <p className="mt-1 text-xs leading-5 text-[#d8dfe0]">
              {dealModel.detail}
            </p>
          ) : null}
        </div>
      </div>

      <div
        className="mt-5 grid gap-5 lg:grid-cols-2"
        data-testid="action-contact-columns"
      >
        <div className="rounded-md border-t-4 border-orange-600 bg-[#f2ede3] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6d777a]">
            Next action
          </p>
          <p className="mt-1 text-sm font-bold text-[#182225]">
            {actionKind
              ? `${actionKind}${actionDue ? ` · Due ${actionDue}` : ""}`
              : "No next action recorded"}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6d777a]">
            Primary contact
          </p>
          {primaryContact ? (
            <div className="mt-2 grid gap-2 text-sm text-[#315b66]">
              <span className="inline-flex items-center gap-2 font-bold">
                <UserRound className="h-4 w-4 text-[#397064]" />
                {primaryContact.name}
              </span>
              {primaryContact.email ? (
                <a
                  className="inline-flex items-center gap-2 font-semibold hover:text-[#244f47]"
                  href={`mailto:${primaryContact.email}`}
                >
                  <Mail className="h-4 w-4" />
                  {primaryContact.email}
                </a>
              ) : null}
              {primaryContact.phone ? (
                <a
                  className="inline-flex items-center gap-2 font-semibold hover:text-[#244f47]"
                  href={`tel:${primaryContact.phone}`}
                >
                  <Phone className="h-4 w-4" />
                  {primaryContact.phone}
                </a>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 font-bold text-[#71848a]">No primary contact</p>
          )}
        </div>
      </div>
    </section>
  );
}
