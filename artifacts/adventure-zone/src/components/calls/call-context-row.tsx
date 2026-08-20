import { Link } from "wouter";
import { MapPin, UserRound } from "lucide-react";

import { BUSINESS_TIME_ZONE } from "@/lib/business-date";

function dateTime(value: Date | string | null | undefined) {
  if (!value) return "No previous contact";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(value));
}

export function CallContextRow({
  organization,
  contact,
  booking,
  followUp,
  bookingStatusLabel,
  travelLeg,
  lastContactedAt,
}: {
  organization: { id: string; name: string; lastResort?: boolean } | null;
  contact: { id: string; name: string } | null;
  booking: { id: string; name: string; city?: string | null; region?: string | null } | null;
  followUp: { kind: string; dueAt: Date } | null;
  bookingStatusLabel?: string | null;
  travelLeg?: { name: string } | null;
  lastContactedAt?: Date | string | null;
}) {
  const location = booking ? [booking.city, booking.region].filter(Boolean).join(", ") : "";
  const profileName = organization?.name ?? contact?.name ?? "Call profile";

  return (
    <section
      aria-label="Call profile"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
      data-testid="call-profile-card"
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-700 sm:h-20 sm:w-20">
          <UserRound className="h-7 w-7 sm:h-9 sm:w-9" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">Call profile</p>
          {organization ? (
            <Link className="mt-1 block break-words text-xl font-bold tracking-tight text-slate-950 hover:text-orange-700 sm:text-2xl" href={`/profiles/${organization.id}`}>
              {organization.name}
            </Link>
          ) : (
            <p className="mt-1 break-words text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{profileName}</p>
          )}

          {booking ? (
            <Link className="mt-1 block break-words font-semibold text-orange-700 hover:underline" href={`/bookings/${booking.id}`}>
              {booking.name}
            </Link>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
            {contact ? (
              <Link className="font-semibold text-slate-800 hover:text-orange-700" href={`/contacts/${contact.id}`}>
                {contact.name}
              </Link>
            ) : (
              <span>No contact linked</span>
            )}
            {location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-4 w-4" /> {location}
              </span>
            ) : null}
            <span>Last contacted: {dateTime(lastContactedAt)}</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {bookingStatusLabel ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{bookingStatusLabel}</span>
            ) : null}
            {travelLeg ? (
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-800">{travelLeg.name}</span>
            ) : null}
            {followUp ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold capitalize text-amber-800">
                {followUp.kind.replaceAll("_", " ")}
              </span>
            ) : null}
            {organization?.lastResort ? (
              <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">Last Resort</span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
