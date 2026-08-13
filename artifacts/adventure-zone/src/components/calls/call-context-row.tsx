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
  organization: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  booking: { id: string; name: string } | null;
  followUp: { kind: string; dueAt: Date } | null;
  bookingStatusLabel?: string | null;
  travelLeg?: { name: string } | null;
  lastContactedAt?: Date | string | null;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Call context">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {contact ? <a className="link font-semibold" href={`/contacts/${contact.id}`}>{contact.name}</a> : <span>No contact linked</span>}
        {organization ? <a className="link" href={`/organizations/${organization.id}`}>{organization.name}</a> : null}
        {booking ? <a className="link" href={`/bookings/${booking.id}`}>{booking.name}</a> : null}
        {bookingStatusLabel ? <span>{bookingStatusLabel}</span> : null}
        {travelLeg ? <span>Travel leg: {travelLeg.name}</span> : null}
        <span>Last contacted: {dateTime(lastContactedAt)}</span>
        {followUp ? <span className="capitalize">{followUp.kind.replaceAll("_", " ")}</span> : null}
      </div>
    </section>
  );
}
