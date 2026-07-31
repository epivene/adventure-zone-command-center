import Link from "next/link";

import type { FollowUpSummary } from "@/features/follow-ups/today-query";
import { BookingOperations } from "@/components/today/booking-operations";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(value);
}

export function callWorkspaceHref(followUp: FollowUpSummary) {
  const parameters = new URLSearchParams();
  if (followUp.contactId) parameters.set("contactId", followUp.contactId);
  if (followUp.bookingId) parameters.set("bookingId", followUp.bookingId);
  parameters.set("followUpId", followUp.id);
  return `/calls/new?${parameters.toString()}`;
}

type EventProfileLinkContext = {
  organizationId: string | null;
  contactId?: string | null;
  bookingId?: string | null;
  followUpId?: string | null;
  action?: "call" | "follow-up";
  mode?: "prospect";
};

export function eventProfileHref(context: EventProfileLinkContext) {
  if (!context.organizationId) return null;

  const parameters = new URLSearchParams();
  if (context.contactId) parameters.set("contactId", context.contactId);
  if (context.bookingId) parameters.set("bookingId", context.bookingId);
  if (context.followUpId) parameters.set("followUpId", context.followUpId);
  if (context.action) parameters.set("action", context.action);
  if (context.mode) parameters.set("mode", context.mode);
  const query = parameters.toString();
  return `/event-profiles/${context.organizationId}${query ? `?${query}` : ""}`;
}

export function followUpHref(followUp: FollowUpSummary) {
  const profileHref = eventProfileHref({
    organizationId: followUp.organizationId,
    contactId: followUp.contactId,
    bookingId: followUp.bookingId,
    followUpId: followUp.id,
    action: "follow-up",
  });
  if (profileHref) return profileHref;
  if (followUp.kind === "call") return callWorkspaceHref(followUp);
  if (followUp.bookingId) return `/bookings/${followUp.bookingId}`;
  if (followUp.contactId) return `/contacts/${followUp.contactId}`;
  return `/organizations/${followUp.organizationId}`;
}

export function NextCallCard({ followUp }: { followUp: FollowUpSummary | null }) {
  const profileHref = followUp
    ? eventProfileHref({
        organizationId: followUp.organizationId,
        contactId: followUp.contactId,
        bookingId: followUp.bookingId,
        followUpId: followUp.id,
        action: "call",
      })
    : null;

  return (
    <section className="rounded-xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
      <p className="text-sm font-bold uppercase tracking-[0.14em] text-orange-800">
        Next call
      </p>
      {followUp ? (
        <div className="mt-3">
          <Link
            className="text-xl font-bold text-slate-950 hover:text-orange-800"
            href={profileHref ?? callWorkspaceHref(followUp)}
          >
            {followUp.bookingName}
          </Link>
          <p className="mt-1 text-sm text-slate-700">
            Call due {formatDate(followUp.dueAt)}
          </p>
          <BookingOperations operations={followUp.operations} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-700">
          No open calls need attention right now.
        </p>
      )}
    </section>
  );
}
